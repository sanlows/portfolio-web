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
function plot(parent,points) {
  const all=points.flatMap(series=>series.points);
  if(!all.length){text(parent,'本快照無可用的歷史曲線。');return;}
  const times=all.map(row=>Date.parse(row[0])), values=all.map(row=>row[1]);
  const first=Math.min(...times),last=Math.max(...times),low=Math.min(...values),high=Math.max(...values);
  const svg=(name,attrs)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',name);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    return node;
  };
  const graph=svg('svg',{viewBox:'0 0 760 200',class:'chart',role:'img','aria-label':'市值走勢，各線起點為100'});
  const x=day=>first===last?380:70+(Date.parse(day)-first)/(last-first)*665;
  const y=value=>low===high?96:165-(value-low)/(high-low)*140;
  for(const value of new Set([low,(low+high)/2,high])){
    graph.append(svg('line',{x1:70,y1:y(value),x2:735,y2:y(value),stroke:'#d6e1dc'}));
    const label=svg('text',{x:5,y:y(value)+4,fill:'#506668','font-size':15});
    label.textContent=shown(value);graph.append(label);
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
  text(parent,points.filter(series=>series.points.length).map(series=>series.label).join(' ｜ '));
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
  if('ratio' in data)text(section('台美股市值占比'),Array.isArray(data.ratio)
    ?'台股 '+shown(data.ratio[0])+'% ｜ 美股 '+shown(data.ratio[1])+'%':'缺少完整估值，無法計算占比。');
  if(data.amount){
    const card=section('實際股票市值');
    table(card,['台美股合計','台股','美股'],[[shown(data.amount.combined,'NT$'),shown(data.amount.tw,'NT$'),shown(data.amount.us,'US$')]]);
    if(data.amount.fx)text(card,'USD/TWD '+shown(data.amount.fx.value)+'（'+data.amount.fx.date+'）');
  }
  if(data.trend) {
    const chart=section('市值走勢');
    const points=(series)=>Array.isArray(series)?series.filter(row=>Array.isArray(row)&&Number.isFinite(Date.parse(row[0]))&&Number.isFinite(row[1])):[];
    plot(chart,[{label:'綠線 · 全部選定帳戶',color:'#006652',points:points(data.trend.full)},
      {label:'藍線 · 部分帳戶',color:'#365ab5',points:points(data.trend.partial)}]);
    text(chart,'各線各自以首筆為 100。部分帳戶線涵蓋尚未有全部帳戶快照的期間。');
  }
  if(Array.isArray(data.bank)){
    table(section('台股銀行餘額'),['帳戶','資料日','餘額'],data.bank.map(row=>[row.account,row.date,shown(row.amount,'NT$')]));
  }
  if(Array.isArray(data.accounts)){
    for(const item of data.accounts){
      const unit=item.market==='tw'?'NT$':'US$';
      const card=section(item.account+'｜'+(item.market==='tw'?'台股':'美股'));
      text(card,'持股資料日 '+item.date);
      table(card,['代號','股數','市值'],item.holdings.map(row=>[row[0],shown(row[1]),shown(row[2],unit)]));
    }
  }
}
decode(location.hash).then(render).catch(error=>{
  root.replaceChildren();
  status.textContent='無法開啟快照：'+error.message;
});
