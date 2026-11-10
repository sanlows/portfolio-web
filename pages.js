'use strict';

(() => {
  const storage = 'portfolio-web-pages-v1';
  const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(new Date());
  const empty = () => ({version:1,revision:0,snapshots:[],quotes:{},included:null});
  const read = () => JSON.parse(localStorage.getItem(storage) || 'null') || empty();

  function write(next, revision) {
    if (read().revision !== revision) throw new Error('此瀏覽器的資料已更新，請重新整理再操作。');
    next.revision = revision + 1;
    localStorage.setItem(storage, JSON.stringify(next));
    return next;
  }

  function parseRows(text, delimiter) {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') value += char;
        else if (text[i + 1] === '"') {value += '"'; i++;}
        else quoted = false;
      } else if (char === '"' && !value) quoted = true;
      else if (char === delimiter) {row.push(value); value = '';}
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(value); rows.push(row); row = []; value = '';
      } else value += char;
    }
    if (quoted) throw new Error('CSV 引號未閉合。');
    row.push(value); rows.push(row);
    return rows.filter(cells => cells.some(cell => cell.trim()));
  }

  function records(text, delimiter) {
    const [headers, ...body] = parseRows(text.replace(/^\uFEFF/, ''), delimiter);
    if (!headers || !body.length) throw new Error('請提供含標題和至少一筆資料的檔案。');
    const keys = headers.map(value => value.trim());
    if (new Set(keys).size !== keys.length || keys.some(key => !key)) throw new Error('欄位標題重複或空白。');
    return body.map((cells, i) => {
      if (cells.length !== keys.length) throw new Error('第 '+(i+2)+' 列欄位數不一致。');
      return Object.fromEntries(keys.map((key, j) => [key, cells[j].trim()]));
    });
  }

  const field = (record, ...keys) => keys.map(key => record[key]).find(value => value !== undefined && value !== '');
  function numeric(value, required = false) {
    if (value == null || String(value).trim() === '') {
      if (required) throw new Error('缺少必要的股數或金額。');
      return null;
    }
    const raw = String(value).trim().replace(/[,$\s]/g,'').replace(/^[−—]/,'-');
    const result = Number(raw);
    if (!raw || !Number.isFinite(result)) throw new Error('有無效的股數或金額。');
    return result;
  }

  function day(input) {
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/.exec(String(input));
    if (!match) throw new Error('資料日期格式無效。');
    const day = match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
    const timestamp = Date.parse(day);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== day || day > today())
      throw new Error('資料日期無效或尚未到來。');
    return day;
  }

  function holding(data) {
    const code = String(data.code??'').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,24}$/.test(code)) throw new Error('缺少或無效的股票代號。');
    const row = {code,name:String(data.name??''),shares:numeric(data.shares,true),cost:numeric(data.cost),
      price:numeric(data.price),market:numeric(data.market),pnl:numeric(data.pnl)};
    if ([row.shares,row.cost,row.price,row.market].some(value => value != null && value < 0))
      throw new Error(code+' 的股數、成本、價格或市值有負值。');
    return row;
  }

  function snapshot(market, account, date, rows, summary, source) {
    if (!['tw','us'].includes(market) || !String(account??'').trim() || !rows.length)
      throw new Error('需要市場、帳戶及持股資料。');
    if (market==='us' && new Set(rows.map(row=>row.code)).size !== rows.length)
      throw new Error('美股匯入有重複代號。');
    return {market,account:String(account).trim(),date:day(date),rows,summary,source};
  }

  function tw(record) {
    const name = field(record,'股票名稱','名稱','商品名稱','證券名稱');
    return holding({
      code:field(record,'股票代碼','股票代號','代號','股號','證券代號') ?? name?.match(/\((\d+[A-Z]*)\)/i)?.[1],
      name,shares:field(record,'庫存股數','即時庫存','昨日餘額','股數','庫存'),
      cost:field(record,'持有成本','付出成本','成本','投入成本'),
      price:field(record,'現價','市價','參考價','成交價'),
      market:field(record,'股票現值','現值','市值','庫存市值'),
      pnl:field(record,'未實現損益','損益試算','評價損益','損益')
    });
  }

  function us(record) {
    const shares=numeric(field(record,'股數','數量'),true);
    const price=numeric(field(record,'價格','現價'),true);
    const unitCost=numeric(field(record,'單位成本'));
    const cost=numeric(field(record,'總成本','成本')) ?? (unitCost==null?null:unitCost*shares);
    const market=numeric(field(record,'市值')) ?? shares*price;
    const pnl=numeric(field(record,'益損$','損益$')) ?? (cost==null?null:market-cost);
    const row=holding({code:field(record,'股票','代號','股票代號'),shares,price,cost,market,pnl});
    if (shares <= 0 || Math.abs(market-shares*price)>Math.max(.02,shares*price*.02))
      throw new Error(row.code+' 股數或市值與價格不符。');
    if (cost!=null && pnl!=null && Math.abs((market-cost)-pnl)>Math.max(1,market*.02))
      throw new Error(row.code+' 損益與市值減成本不符。');
    return row;
  }

  function summaryText(text) {
    function grab(aliases) {
      for (const label of aliases) {
        const hit = new RegExp(label+'[\\t :=：]*([+−-]?\\$?[+−-]?[\\d,]+(?:\\.\\d+)?)').exec(text);
        if (hit) return numeric(hit[1]);
      }
      return null;
    }
    const total=grab(['賬戶總值','帳戶總值']),stock=grab(['持有股票市值','股票總值','持股市值']);
    return total==null&&stock==null?null:{total,stock,margin:grab(['融資結餘','融資餘額'])};
  }

  function usPaste(text) {
    const lines=text.split(/\r?\n/);
    const start=lines.findIndex(line => /^(代號|股票代號|股票)(?:\t| {2,})/.test(line.trim()));
    if (start<0) throw new Error('找不到 Firstrade 持股標題。');
    const delimiter=lines[start].includes('\t')?'\t':'  ';
    if (delimiter==='\t') {
      const [header,...body] = lines.slice(start).filter(line=>line.trim());
      return records([header,...body].join('\n'),'\t');
    }
    return records(lines.slice(start).map(line=>line.trim().replace(/ {2,}/g,'\t')).join('\n'),'\t');
  }

  function imported(input) {
    const {market,method,text,summary}=input;
    if (method==='paste') {
      if (market==='tw') return [snapshot('tw',input.account,input.date,records(text,'\t').map(tw),null,'貼上')];
      return [snapshot('us','Firstrade',input.date,usPaste(text||summary).map(us),summaryText(summary+'\n'+text),'貼上')];
    }
    const groups=new Map();
    const accounts=new Map(summary ? records(summary,',').map(row=>[day(row['日期']),{
      total:numeric(field(row,'賬戶總值','帳戶總值')),stock:numeric(row['股票總值']),margin:numeric(row['融資結餘'])
    }]) : []);
    for (const record of records(text,',')) {
      const account=market==='tw'?(record['帳號']||'主帳號'):'Firstrade';
      const date=day(record['日期']);
      const key=JSON.stringify([account,date]);
      const group=groups.get(key)||{account,date,rows:[]};
      group.rows.push(market==='tw'?tw(record):us(record));
      groups.set(key,group);
    }
    return [...groups.values()].map(group=>snapshot(market,group.account,group.date,group.rows,
      market==='us'?accounts.get(group.date)??null:null,'歷史 CSV'));
  }

  const identity = item => JSON.stringify([item.market,item.account,item.date]);
  function backup(input) {
    if (input.version!==1 || !Array.isArray(input.snapshots) || typeof input.quotes!=='object' || input.quotes===null)
      throw new Error('備份格式不正確。');
    const snapshots=input.snapshots.map(item=>snapshot(item.market,item.account,item.date,item.rows.map(holding),
      item.summary==null?null:{
        total:numeric(item.summary.total),stock:numeric(item.summary.stock),margin:numeric(item.summary.margin)
      },String(item.source)));
    const quotes=Object.fromEntries(Object.entries(input.quotes).map(([key,series])=>[key,
      Object.fromEntries(Object.entries(series).map(([date,price])=>{
        const value=numeric(price,true);
        if (value<=0) throw new Error('備份包含無效行情。');
        return [day(date),value];
      }))
    ]));
    const keys=new Set(snapshots.map(item=>item.market+':'+item.account));
    const included=input.included;
    if (included!==null && (!Array.isArray(included) || included.some(key=>!keys.has(key))))
      throw new Error('備份包含無效的帳戶設定。');
    return {...empty(),snapshots,quotes,included};
  }

  async function run(path, input) {
    const state=read();
    if (path==='state') return {state,today:today()};
    if (path==='preview'||path==='import') {
      const items=imported(input);
      const previous=new Map(state.snapshots.map(item=>[identity(item),item]));
      const conflicts=items.filter(item=>previous.has(identity(item))).length;
      if (path==='preview') return {items,conflicts,revision:state.revision};
      if (conflicts&&!input.replace) throw new Error('請確認同日修訂。');
      for (const item of items) {
        item.summary??=previous.get(identity(item))?.summary??null;
        state.snapshots.push(item);
      }
      return {state:write(state,input.revision)};
    }
    if (path==='settings') {
      state.included=input.included;
      return {state:write(state,input.revision)};
    }
    if (path==='restore') {
      return {state:write(backup(input.data),input.revision)};
    }
    throw new Error('GitHub Pages 版可讀取匯入的行情備份。');
  }
  window.portfolioPages=run;
})();
