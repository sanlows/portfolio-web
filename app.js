'use strict';
const $=id=>document.getElementById(id);
const marketNames={tw:'台股',us:'美股'};
const marketUnit={tw:'NT$',us:'US$'};
const marketKey=item=>item.market+':'+item.account;
const money=(value,unit)=>value==null?'—':unit+' '+value.toLocaleString('zh-TW',{maximumFractionDigits:unit==='US$'?2:0});
const amount=value=>value==null?'—':value.toLocaleString('zh-TW',{maximumFractionDigits:6});
const palette=['#006652','#365ab5','#b34a20','#782f9e','#776000','#a02b68'];
const pages=window.portfolioPages;
const drive=window.portfolioDrive;
let state,token,today,page='overview',mode='benchmark',busy=false,preview,formVersion=0;
const muted=new Set();

async function api(path,data){
  if(pages)return pages(path,data);
  const response=await fetch('/api/'+path,data===undefined?{}:{
    method:'POST',headers:{'Content-Type':'application/json','X-Portfolio-Token':token},body:JSON.stringify(data)
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error);
  return result;
}
function status(message){$('status').textContent=message;}
async function act(message,work){
  if(busy)return;
  busy=true;status(message);$('refresh').disabled=true;
  try{await work();}catch(error){status(error.message);}
  finally{busy=false;$('refresh').disabled=!pages&&!state?.snapshots.length;}
}
function table(headers,rows){
  if(!rows.length)return document.createTextNode('目前沒有資料。');
  const table=document.createElement('table');
  const heading=table.createTHead().insertRow();
  for(const text of headers){
    const th=document.createElement('th');th.textContent=text;th.scope='col';heading.append(th);
  }
  const body=table.createTBody();
  for(const values of rows){
    const row=body.insertRow();
    for(const value of values)row.insertCell().textContent=value;
  }
  return table;
}
function accountMap(){
  return new Map(state.snapshots.map(item=>[marketKey(item),item]));
}
function asOf(key,day){
  return state.snapshots.reduce((best,item)=>
    marketKey(item)===key&&item.date<=day&&(!best||item.date>=best.date)?item:best,null);
}
function quote(key,day){
  const values=state.quotes[key]||{};
  const date=Object.keys(values).filter(date=>date<=day).sort().at(-1);
  return date?{date,value:values[date]}:null;
}
function valueRow(item,row,day){
  const close=quote(item.market+':'+row.code,day);
  if(close&&close.date>=item.date&&row.shares!=null)return {value:close.value*row.shares,date:close.date,source:'行情'};
  return {value:row.market,date:item.date,source:'券商快照'};
}
function valueAccount(item,day){
  if(!item)return null;
  const values=item.rows.map(row=>valueRow(item,row,day).value);
  return values.includes(null)?null:values.reduce((sum,value)=>sum+value,0);
}
function selected(){
  return state.included??[...accountMap().keys()];
}
function overviewAt(day){
  const values={tw:0,us:0}, missing={tw:false,us:false}, counts={tw:0,us:0};
  for(const key of selected()){
    const market=key.split(':',1)[0];counts[market]++;
    const value=valueAccount(asOf(key,day),day);
    if(value==null)missing[market]=true;
    else values[market]+=value;
  }
  const fx=quote('fx',day);
  const rate=fx&&(Date.parse(day)-Date.parse(fx.date))/86400000<=7?fx:null;
  return {values,missing,counts,rate,total:selected().length&&!missing.tw&&!missing.us&&(!counts.us||rate)
    ?values.tw+values.us*(rate?.value??0):null};
}
function dates(keys){
  const accounts=new Set(keys);
  const values=new Set(state.snapshots.filter(item=>accounts.has(marketKey(item))).map(item=>item.date));
  if(!values.size)return [];
  const start=[...values].sort()[0];
  const symbols=new Set(state.snapshots.filter(item=>accounts.has(marketKey(item)))
    .flatMap(item=>item.rows.map(row=>item.market+':'+row.code)));
  symbols.add('fx');
  for(const symbol of symbols){
    for(const date of Object.keys(state.quotes[symbol]||{})){
      if(date>=start&&date<=today)values.add(date);
    }
  }
  return [...values].sort();
}
function period(select,days){
  const active=select.value||'all';
  const years=[...new Set(days.map(day=>day.slice(0,4)))].reverse();
  select.replaceChildren(new Option('全期間','all'),new Option('今年','current'),
    ...years.map(year=>new Option(year+' 年',year)));
  select.value=[...select.options].some(option=>option.value===active)?active:'all';
  const year=select.value==='current'?today.slice(0,4):select.value;
  return select.value==='all'?days:days.filter(day=>day.startsWith(year));
}
function svg(name,attrs){
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
  return node;
}
function drawChart(container,days,series,format,toggle){
  container.replaceChildren();
  const visible=series.filter(line=>!toggle||!muted.has(line.name));
  const values=visible.flatMap(line=>line.values).filter(Number.isFinite);
  if(!values.length)container.append('此期間沒有足夠資料可繪圖。');
  else {
    const min=values.reduce((a,b)=>Math.min(a,b)), max=values.reduce((a,b)=>Math.max(a,b));
    const chart=svg('svg',{class:'chart',viewBox:'0 0 800 215',role:'img','aria-label':visible.map(line=>line.name).join('、')});
    const left=118,right=776,first=Date.parse(days[0]),last=Date.parse(days.at(-1));
    const x=i=>first===last?400:left+(right-left)*(Date.parse(days[i])-first)/(last-first);
    const y=value=>min===max?100:180-(value-min)*145/(max-min);
    for(const ratio of [0,.5,1]){
      const level=min+(max-min)*ratio, yPos=min===max?100:180-145*ratio;
      if(min===max&&ratio!==0)continue;
      chart.append(svg('line',{x1:left,x2:right,y1:yPos,y2:yPos,stroke:'#d6e1dc'}));
      const label=svg('text',{x:8,y:yPos+4,fill:'#506668','font-size':14});
      label.textContent=format(level);chart.append(label);
    }
    for(const line of visible){
      let path='', connected=false;
      line.values.forEach((value,i)=>{
        if(value==null){connected=false;return;}
        path+=(connected?'L':'M')+x(i)+' '+y(value)+' ';
        connected=true;
      });
      chart.append(svg('path',{d:path,fill:'none',stroke:line.color,'stroke-width':3}));
      line.values.forEach((value,i)=>{
        if(value==null)return;
        const dot=svg('circle',{cx:x(i),cy:y(value),r:3,fill:line.color});
        const title=svg('title',{});title.textContent=days[i]+' '+line.name+' '+format(value);
        dot.append(title);chart.append(dot);
      });
    }
    container.append(chart);
    const range=document.createElement('p');
    range.textContent=days[0]+' ～ '+days.at(-1);container.append(range);
  }
  const legend=document.createElement('div');legend.className='legend';
  for(const line of series){
    const label=document.createElement(toggle?'button':'span');
    const swatch=svg('svg',{width:16,height:10,'aria-hidden':'true'});
    swatch.append(svg('line',{x1:1,x2:13,y1:6,y2:6,stroke:line.color,'stroke-width':3}));
    label.append(swatch,line.name+' · '+(line.values.at(-1)==null?'—':format(line.values.at(-1))));
    if(toggle){
      label.setAttribute('aria-pressed',String(!muted.has(line.name)));
      label.onclick=()=>{if(muted.has(line.name))muted.delete(line.name);else muted.add(line.name);toggle();};
    }
    legend.append(label);
  }
  container.append(legend);
}
function renderOverview(){
  $('emptyGuide').hidden=state.snapshots.length>0;
  const days=dates(selected());
  const valuationDay=days.at(-1);
  const total=valuationDay?overviewAt(valuationDay):null;
  $('combined').textContent=money(total?.total,'NT$');
  $('twTotal').textContent=money(total?.counts.tw&&!total.missing.tw?total.values.tw:null,'NT$');
  $('usTotal').textContent=money(total?.counts.us&&!total.missing.us?total.values.us:null,'US$');
  const accounts=selected().map(key=>asOf(key,valuationDay)).filter(Boolean);
  $('sources').textContent=valuationDay
    ?'持股日：'+accounts.map(item=>item.account+' '+item.date).join('、')+' ｜ '+(total.rate?'匯率 '+total.rate.value.toFixed(3)+'（'+total.rate.date+'）':'無可用匯率'+(pages?'，可由本機版行情備份帶入':''))
      +(total.total==null?' ｜ 估值資料不完整':'')
    :'請先匯入持股，或在設定選擇納入總覽的帳戶。';
  const filtered=period($('overviewPeriod'),days);
  drawChart($('overviewChart'),filtered,[{name:'合計市值',color:palette[0],values:filtered.map(day=>overviewAt(day).total)}],value=>money(value,'NT$'));
}
function renderMarketChart(key,item){
  const days=period($('marketPeriod'),dates(key?[key]:[]));
  $('benchmark').setAttribute('aria-pressed',String(mode==='benchmark'));
  $('individual').setAttribute('aria-pressed',String(mode==='individual'));
  if(mode==='individual'){
    $('chartNote').textContent='目前全部持股各一條線。點圖例可暫時隱藏。';
    const codes=[...new Set(item?.rows.map(row=>row.code))];
    const lines=codes.map((code,i)=>({name:code,color:palette[i%palette.length],values:days.map(day=>{
      const snap=asOf(key,day);
      if(!snap)return null;
      const values=snap.rows.filter(row=>row.code===code).map(row=>valueRow(snap,row,day).value);
      return values.includes(null)?null:values.reduce((sum,value)=>sum+value,0);
    })}));
    drawChart($('marketChart'),days,lines,value=>money(value,marketUnit[page]),renderDetail);
    return;
  }
  const benchmark=page==='us'?'spy':'taiex';
  const label=page==='us'?'SPY（還原收盤）':'台灣加權指數';
  const matched=days.flatMap(day=>{
    const value=valueAccount(asOf(key,day),day), close=quote(benchmark,day);
    return value!=null&&close&&(Date.parse(day)-Date.parse(close.date))/86400000<=7?[[day,value,close.value]]:[];
  });
  $('chartNote').textContent='與 '+label+' 比較，共同起點為 100。持股市值會受部位變化影響。';
  const start=matched.findIndex(([,value])=>value>0);
  if(start<0||matched.length-start<2){
    $('marketChart').textContent='所選期間需要至少兩筆共同估值及基準資料。';
    return;
  }
  const points=matched.slice(start);
  drawChart($('marketChart'),points.map(point=>point[0]),[
    {name:'持股市值',color:palette[0],values:points.map(point=>100*point[1]/points[0][1])},
    {name:label,color:palette[1],values:points.map(point=>100*point[2]/points[0][2])}
  ],value=>value.toFixed(2));
}
function renderDetail(){
  const previous=$('account').value;
  const keys=[...accountMap()].filter(([,item])=>item.market===page);
  $('account').replaceChildren(...keys.map(([key,item])=>new Option(item.account,key)));
  if(keys.some(([key])=>key===previous))$('account').value=previous;
  const key=$('account').value, item=asOf(key,today), unit=marketUnit[page];
  $('marketTitle').textContent=marketNames[page]+'明細';
  const summary=item?.summary;
  $('holdingDate').textContent=item?'持股快照 '+item.date+(summary
    ?' ｜ 帳戶總值 '+money(summary.total,unit)+' ｜ 融資 '+money(summary.margin,unit):''):'請先匯入持股。';
  $('holdings').replaceChildren(table(['股票','股數','總成本','券商損益','估值市值','價格日期／來源'],
    (item?.rows||[]).map(row=>{
      const estimate=valueRow(item,row,today);
      return [row.code+(row.name?' '+row.name:''),amount(row.shares),money(row.cost,unit),money(row.pnl,unit),
        money(estimate.value,unit),estimate.date+'／'+estimate.source];
    })));
  const revisions=state.snapshots.filter(s=>marketKey(s)===key).map((s,i)=>[s.date,s.source,s.rows.length,i+1]).reverse();
  $('revisions').replaceChildren(table(['日期','來源','筆數','匯入序號'],revisions));
  renderMarketChart(key,item);
  const analysis=analysisData(item);
  $('copy').disabled=!analysis;
  $('concentration').textContent=analysis
    ?'最大持股 '+analysis.rows[0].code+' · '+analysis.rows[0].weight.toFixed(1)+'% ｜ 持股快照 '+item.date
    :'需要完整市值才可計算集中度。';
  $('copyFallback').hidden=true;
}
function analysisData(item){
  if(!item)return null;
  const total=valueAccount(item,today);
  if(!(total>0))return null;
  const grouped=new Map();
  for(const row of item.rows){
    const value=valueRow(item,row,today);
    const group=grouped.get(row.code)||{code:row.code,value:0,dates:new Set()};
    group.value+=value.value;group.dates.add(value.date);grouped.set(row.code,group);
  }
  return {market:marketNames[item.market],currency:item.market==='tw'?'TWD':'USD',snapshotDate:item.date,
    rows:[...grouped.values()].sort((a,b)=>b.value-a.value).map(row=>({code:row.code,value:row.value,
      valuationDates:[...row.dates],weight:100*row.value/total}))};
}
function renderSettings(){
  $('options').replaceChildren(...[...accountMap()].map(([key,item])=>{
    const input=document.createElement('input');input.type='checkbox';input.name='account';input.value=key;
    input.checked=selected().includes(key);
    const label=document.createElement('label');label.append(input,' '+marketNames[item.market]+' · '+item.account);
    return label;
  }));
}
function render(){
  for(const button of document.querySelectorAll('[data-page]')){
    if(button.dataset.page===page)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  $('overview').hidden=page!=='overview';
  $('settings').hidden=page!=='settings';
  $('detail').hidden=!(page in marketNames);
  if(page==='overview')renderOverview();
  else if(page==='settings')renderSettings();
  else renderDetail();
}
function invalidate(){formVersion++;preview=null;$('preview').hidden=true;}
function importMode(){
  invalidate();
  const csv=$('method').value==='csv';
  $('csvFields').hidden=!csv;$('pasteFields').hidden=csv;
}
async function readFile(input,required){
  const file=input.files[0];
  if(!file){if(required)throw new Error('請選擇 CSV 檔');return '';}
  if(file.size>8_000_000)throw new Error('CSV 請小於 8 MB');
  return file.text();
}
async function showPreview(){
  const version=formVersion;
  const method=$('method').value;
  const input={market:page,method,account:$('importAccount').value,date:$('date').value,
    text:method==='csv'?await readFile($('csv'),true):$('text').value,
    summary:page==='us'?(method==='csv'?await readFile($('summaryFile'),false):$('summaryText').value):''};
  const result=await api('preview',input);
  if(version!==formVersion){status('匯入內容已變更，請重新預覽。');return;}
  preview={...input,revision:result.revision,replace:result.conflicts>0};
  const details=document.createElement('p');
  details.textContent='共 '+result.items.length+' 筆帳戶日快照。'+
    (result.conflicts?' 其中 '+result.conflicts+' 筆已有同日資料，確認後保存為新修訂。':'');
  const list=document.createElement('div');list.className='scroll';
  list.append(table(['帳戶','日期','筆數','股票代號'],result.items.slice(0,20).map(item=>
    [item.account,item.date,item.rows.length,item.rows.map(row=>row.code).join('、')])));
  if(result.items.length>20)details.textContent+=' 下表預覽前 20 筆。';
  const first=result.items[0];
  const holdings=document.createElement('div');holdings.className='scroll';
  holdings.append(table(['首筆快照股票','股數','成本','市值'],first.rows.map(row=>
    [row.code,amount(row.shares),money(row.cost,marketUnit[page]),money(row.market,marketUnit[page])])));
  const confirm=document.createElement('button');confirm.type='button';confirm.className='primary';
  confirm.textContent=result.conflicts?'確認儲存修訂':'確認儲存';
  confirm.onclick=()=>act('儲存中',async()=>{
    if(!preview)return;
    state=(await api('import',preview)).state;
    invalidate();$('import').hidden=true;
    render();status('持股已儲存於本機資料庫。');
  });
  $('preview').replaceChildren(details,list,holdings,confirm);$('preview').hidden=false;
  status('預覽完成，請確認資料後儲存。');
}
async function refresh(){
  await act('正在查詢行情，請稍候。',async()=>{
    const result=await api('quotes',{});
    state=result.state;render();
    status(result.warnings.length?'行情更新有缺漏，保留先前可用資料。\n'+result.warnings.join('\n'):'行情已更新。持股快照保留。');
  });
}
function bind(){
  for(const button of document.querySelectorAll('[data-page]'))button.onclick=()=>{
    if(busy)return;
    page=button.dataset.page;muted.clear();mode='benchmark';
    $('import').hidden=true;invalidate();render();
  };
  for(const button of document.querySelectorAll('[data-import]'))button.onclick=()=>{
    if(busy)return;
    document.querySelector('[data-page="'+button.dataset.import+'"]').click();
    $('showImport').click();
  };
  $('account').onchange=()=>{muted.clear();renderDetail();};
  $('overviewPeriod').onchange=renderOverview;$('marketPeriod').onchange=renderDetail;
  $('benchmark').onclick=()=>{mode='benchmark';renderDetail();};
  $('individual').onclick=()=>{mode='individual';renderDetail();};
  $('refresh').onclick=pages?()=>{
    document.querySelector('[data-page=settings]').click();
    $('restoreFile').focus();
  }:refresh;
  if(pages){
    $('edition').textContent=drive?'私人 Google Drive 同步版':'GitHub Pages · 資料存於此瀏覽器';
    $('refresh').textContent='匯入行情備份';
    $('backupHelp').textContent='持股留在此瀏覽器。可下載備份，也可還原本機版匯出的 JSON，帶入行情與匯率。';
    $('restoreForm').hidden=false;
    $('restoreForm').onsubmit=event=>{
      event.preventDefault();
      act('正在讀取備份',async()=>{
        const data=JSON.parse(await readFile($('restoreFile'),true));
        if(state.snapshots.length&&!window.confirm('還原會取代此瀏覽器的持股與行情。是否繼續？')){status('已取消還原。');return;}
        state=(await api('restore',{data,revision:state.revision})).state;
        event.target.reset();render();status('已還原至此瀏覽器。');
      });
    };
  }
  $('showImport').onclick=()=>{
    $('import').reset();
    $('accountField').hidden=page==='us';
    $('summaryTextField').hidden=page==='tw';$('summaryFileField').hidden=page==='tw';
    $('csvHelp').textContent=page==='tw'?'選擇台股 V1.5 的 portfolio_history.csv，會按檔案內的帳號與日期匯入。':'選擇美股 V1.8 的 stock_data.csv，可同時附上 account_data.csv。';
    const names=[...new Set(['主帳號','Eason',...[...accountMap().values()].filter(item=>item.market==='tw').map(item=>item.account)])];
    $('accountNames').replaceChildren(...names.map(name=>new Option(name)));
    $('importAccount').value=asOf($('account').value,today)?.account||'主帳號';
    $('date').max=today;$('date').value=today;importMode();$('import').hidden=false;
  };
  $('method').onchange=importMode;
  $('import').addEventListener('input',invalidate);
  $('import').onsubmit=event=>{event.preventDefault();invalidate();act('驗證資料中',showPreview);};
  $('cancel').onclick=()=>{if(!busy){invalidate();$('import').hidden=true;}};
  $('settingsForm').onsubmit=event=>{
    event.preventDefault();
    act('儲存設定中',async()=>{
      state=(await api('settings',{included:new FormData(event.target).getAll('account'),revision:state.revision})).state;
      render();status('總覽設定已儲存。');
    });
  };
  $('backup').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='portfolio-backup-'+today+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('copy').onclick=async()=>{
    const data=analysisData(asOf($('account').value,today));
    if(!data)return;
    const prompt='請根據以下持股快照分析部位集中度及資料限制。僅使用提供的數字，不補造新聞或行情。\n'+JSON.stringify(data,null,2);
    try{await navigator.clipboard.writeText(prompt);status('已複製。確認分享內容後，可貼到自己的 ChatGPT。');}
    catch{$('copyFallback').value=prompt;$('copyFallback').hidden=false;$('copyFallback').select();}
  };
}
async function syncDrive(){
  const display=$('driveStatus');
  const previous=state.lastDriveSync
    ?'上次成功：'+new Date(state.lastDriveSync).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'。 ':'';
  $('driveRefresh').disabled=true;
  display.textContent=previous+'正在讀取私人備份。';
  try{
    const backups=await drive();
    const result=await api('drive-sync',{backups});
    state=result.state;
    display.textContent='已同步 Google Drive，新增 '+result.added+' 筆快照。'
      +(result.taiwan?'':' 台股尚未指定 Drive 備份。')
      +(result.conflicts?' 已保留 '+result.conflicts+' 筆同日手動匯入紀錄。':'');
    if(!busy)render();
  }catch(error){
    display.textContent=previous+error.message;
  }finally{$('driveRefresh').disabled=false;}
}
(async()=>{
  try{
    ({state,token,today}=await api('state'));bind();render();
    $('refresh').disabled=!pages&&!state.snapshots.length;
    status(state.snapshots.length?(pages?'已載入此瀏覽器的持股。':'已載入本機紀錄。'):'尚未匯入資料。請使用下方的匯入按鈕。');
    if(drive){
      $('drivePanel').hidden=false;
      $('driveRefresh').onclick=syncDrive;
      await syncDrive();
    }
    if(!pages&&state.snapshots.length&&state.lastRefresh!==today)refresh();
  }catch(error){status('載入失敗：'+error.message);}
})();

