'use strict';
const root=document.getElementById('shareData');
const status=document.getElementById('shareStatus');
const shown=(value,unit='')=>Number.isFinite(value)
  ?(unit?unit+' ':'')+value.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
function section(title) {
  const card=document.createElement('section');card.className='card';
  const heading=document.createElement('h2');heading.textContent=title;
  card.append(heading);root.append(card);return card;
}
function text(parent,value){
  const p=document.createElement('p');p.textContent=value;parent.append(p);
}
function table(parent,headers,rows) {
  const container=document.createElement('div');container.className='scroll';
  const table=document.createElement('table');
  const header=table.createTHead().insertRow();
  for(const label of headers){
    const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);
  }
  const body=table.createTBody();
  for(const items of rows){
    const row=body.insertRow();
    for(const value of items)row.insertCell().textContent=value??'—';
  }
  container.append(table);parent.append(container);
}
function plot(parent,points,bridge) {
  const all=points.flatMap(series=>series.points);
  if(!all.length){text(parent,'本快照無可用的歷史曲線。');return;}
  const times=all.map(row=>Date.parse(row[0])), values=all.map(row=>row[1]);
  const first=Math.min(...times),last=Math.max(...times),low=Math.min(...values),high=Math.max(...values);
  const svg=(name,attrs)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',name);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    return node;
  };
  const graph=svg('svg',{viewBox:'0 0 760 200',class:'chart',role:'img','aria-label':'合計市值走勢'});
  const x=day=>first===last?380:70+(Date.parse(day)-first)/(last-first)*665;
  const y=value=>low===high?96:165-(value-low)/(high-low)*140;
  for(const value of new Set([low,(low+high)/2,high])){
    graph.append(svg('line',{x1:70,y1:y(value),x2:735,y2:y(value),stroke:'#d6e1dc'}));
    const label=svg('text',{x:5,y:y(value)+4,fill:'#506668','font-size':15});
    label.textContent=shown(value);graph.append(label);
  }
  if(bridge){
    const [from,to]=bridge;
    const connector=svg('line',{x1:x(from[0]),y1:y(from[1]),x2:x(to[0]),y2:y(to[1]),
      stroke:'#697c79','stroke-width':2,'stroke-dasharray':'6 4'});
    const tip=svg('title',{});tip.textContent='帳戶納入範圍改變';connector.append(tip);graph.append(connector);
  }
  for(const series of points){
    graph.append(svg('polyline',{points:series.points.map(row=>x(row[0])+','+y(row[1])).join(' '),
      fill:'none',stroke:series.color,'stroke-width':3}));
    for(const [day,value] of series.points){
      const dot=svg('circle',{cx:x(day),cy:y(value),r:2.5,fill:series.color});
      const tip=svg('title',{});tip.textContent=day+' '+series.label+' '+shown(value);dot.append(tip);graph.append(dot);
    }
  }
  parent.append(graph);
  text(parent,new Date(first).toISOString().slice(0,10)+' ～ '+new Date(last).toISOString().slice(0,10));
  const labels=points.filter(series=>series.points.length).map(series=>series.label);
  if(bridge)labels.push('虛線 · 帳戶納入範圍改變');
  text(parent,labels.join(' ｜ '));
}
async function decode(hash) {
  const match=/^#v1\.([A-Za-z0-9_-]{1,12000})$/.exec(hash);
  if(!match)throw new Error('請開啟對方傳來的完整快照連結。');
  const bytes=Uint8Array.from(atob(match[1].replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let size=0,json='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for(;;){
    const {value,done}=await stream.read();
    if(done)break;
    size+=value.byteLength;
    if(size>250000){await stream.cancel();throw new Error('快照超過可讀取大小。');}
    json+=decoder.decode(value,{stream:true});
  }
  json+=decoder.decode();
  const snapshot=JSON.parse(json);
  if(snapshot.version!==1||!Number.isFinite(Date.parse(snapshot.createdAt))||!Number.isFinite(Date.parse(snapshot.day)))
    throw new Error('快照格式無效。');
  return snapshot;
}
function render(data) {
  status.textContent='快照建立時間 '+new Date(data.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})
    +'（台北） ｜ 最後估值日 '+data.day+' ｜ 資料不會隨原帳戶更新';
  if(data.amount){
    const assets=data.amount.basis==='assets';
    const grid=document.createElement('div');grid.className='grid';
    const cards=assets?['台美股總資產（含餘額）','台股總資產','美股帳戶總值']:
      ['台美股合計市值','台股市值','美股市值'];
    const values=[shown(data.amount.combined,'NT$'),shown(data.amount.tw,'NT$'),shown(data.amount.us,'US$')];
    cards.forEach((name,i)=>{
      const card=document.createElement('div');card.className=i===0?'card total':'card';
      const amount=document.createElement('strong');amount.textContent=values[i];
      card.append(name,amount);grid.append(card);
    });
    root.append(grid);
    if(data.amount.fx)text(root,'USD/TWD '+shown(data.amount.fx.value)+'（'+data.amount.fx.date+'）');
  }
  if(Array.isArray(data.bank)){
    table(section('各帳號餘額'),['帳戶','資料日','銀行餘額'],data.bank.map(row=>[row.account,row.date,shown(row.amount,'NT$')]));
  }
  if(data.trend) {
    const chart=section('合計市值走勢');
    const points=(series)=>Array.isArray(series)?series.filter(row=>Array.isArray(row)&&Number.isFinite(Date.parse(row[0]))&&Number.isFinite(row[1])):[];
    const full=points(data.trend.full),partial=points(data.trend.partial);
    const shared=data.trendBasis==='shared';
    const next=full[0],prior=next&&partial.filter(row=>row[0]<next[0]).at(-1);
    plot(chart,[{label:'綠線 · 全部選定帳戶',color:'#006652',points:full},
      {label:'藍線 · 部分帳戶',color:'#365ab5',points:partial}],shared&&prior&&next?[prior,next]:null);
    text(chart,shared?'兩線共用起點 100。虛線只標示納入帳戶的變動，不表示報酬。':
      '這是舊版快照，兩線各以首筆為 100。');
  }
  if('ratio' in data)text(section('台美股市值占比'),Array.isArray(data.ratio)
    ?'台股 '+shown(data.ratio[0])+'% ｜ 美股 '+shown(data.ratio[1])+'%':'缺少完整估值，無法計算占比。');
  if(Array.isArray(data.accounts)){
    for(const item of data.accounts){
      const unit=item.market==='tw'?'NT$':'US$';
      const card=section(item.account+'｜'+(item.market==='tw'?'台股':'美股'));
      text(card,'持股資料日 '+item.date);
      table(card,['代號','股數','市值'],item.holdings.map(row=>[row[0],shown(row[1]),shown(row[2],unit)]));
    }
  }
}
const snapshotFragment=typeof window.portfolioShortSnapshot==='string'
  ?'#v1.'+window.portfolioShortSnapshot:location.hash;
decode(snapshotFragment).then(render).catch(error=>{
  root.replaceChildren();
  status.textContent='無法開啟快照：'+error.message;
});
