/** Served locally under the operator's authenticated origin; no third-party scripts. */
export const operatorScript = String.raw`
(() => {
  const form = document.querySelector('#query');
  const status = document.querySelector('#status');
  const tooltip = document.querySelector('#chart-tooltip');
  const measure = document.querySelector('#measure');
  const trend = document.querySelector('#trend');
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const number = value => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(value);
  const compact = value => new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:1}).format(value);
  const labelDate = value => new Date(value + 'T00:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
  const palettes = ['var(--accent)', 'var(--blue)', 'var(--amber)', 'var(--purple)', 'var(--green)'];
  const measures = {
    tokens: [['tokens.input','Input tokens'], ['tokens.output','Output tokens']],
    turns: [['turn.started','Started'], ['turn.completed','Completed'], ['turn.failed','Failed'], ['turn.interrupted','Interrupted']],
    features: [['feature.attempted','Attempted'], ['feature.succeeded','Succeeded'], ['feature.failed','Failed'], ['feature.cancelled','Cancelled'], ['feature.unavailable','Unavailable capability']]
  };
  let current = null, selection = null, generation = 0, controller, view = 'usage', period = 7, authenticated = true;
  const isDevelopment = () => form.elements.environment.value === 'development';
  form.elements.environment.value = new URLSearchParams(location.search).get('environment') === 'development' ? 'development' : 'production';
  if (isDevelopment()) measure.value = 'turns';
  const behaviorMeasures = [
    ['streamRate','Observed stream throughput','tok/s','responses'],
    ['responsesPerTurn','Model responses per turn','responses','turns'],
    ['toolsPerTurn','Observed tools per turn','tools','turns'],
    ['multiToolShare','Responses with multiple tools','%','responses'],
    ['reasoningShare','Reasoning share of output','%','turns'],
    ['duration','Mean turn duration','seconds','turns'],
    ['completedRate','Completed turns','%','terminal turns'],
    ['failedRate','Failed turns','%','terminal turns'],
    ['interruptedRate','Interrupted turns','%','terminal turns'],
  ];
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function svgNode(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function empty(target, title = 'No released data', detail = 'Try a different period or breakdown. Withheld data is unavailable.') {
    const element = node('div', undefined, 'empty');
    element.append(node('strong', title), node('span', detail));
    target.replaceChildren(element);
  }
  function swatch(color) {const element = node('span', undefined, 'swatch'); element.style.background = color; return element;}
  function showTooltip(event, text) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || bounds.x + bounds.width / 2;
    const y = event.clientY || bounds.y;
    tooltip.style.left = Math.max(8, Math.min(x + 12, innerWidth - 248)) + 'px';
    tooltip.style.top = Math.max(8, Math.min(y - 48, innerHeight - 80)) + 'px';
  }
  function describePoint(element, text) {
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', text);
    element.addEventListener('mouseenter', event => showTooltip(event, text));
    element.addEventListener('focus', event => showTooltip(event, text));
    element.addEventListener('mouseleave', () => {tooltip.hidden = true;});
    element.addEventListener('blur', () => {tooltip.hidden = true;});
  }
  // Null means no released cell. It must never become a zero-valued point.
  function sum(rows, metric) {
    const values = rows.filter(row => row.metric === metric);
    return values.length ? values.reduce((total, row) => total + row.total, 0) : null;
  }
  function days(from, to) {
    const result = [];
    for (let date = Date.parse(from); date <= Date.parse(to) && result.length < 91; date += 86400000) result.push(day(date));
    return result;
  }
  function renderCards(rows) {
    const metrics = measure.value === 'features' ? measures.features.slice(0,4)
      : [['turn.started','Started turns'],['turn.completed','Completed turns'],...measures.tokens];
    document.querySelector('#kpis').replaceChildren(...metrics.map(([metric, label]) => {
      const card = node('article', undefined, 'kpi');
      const value = sum(rows, metric);
      card.append(node('p',label,'kpi-label'), node('p',value === null ? '—' : compact(value),'kpi-value'),node('p',value === null ? 'Unavailable for this selection' : number(value) + ' · released cells','kpi-note'));
      card.setAttribute('aria-label', label + ': ' + number(value));
      return card;
    }));
  }
  function renderTrend(rows) {
    const metrics = measures[measure.value];
    document.querySelector('#trend-title').textContent = measure.value === 'tokens' ? 'Token usage' : measure.value === 'turns' ? 'Turn activity' : 'Feature activity';
    const legend = document.querySelector('#trend-legend'); legend.replaceChildren();
    for (const [index, [, label]] of metrics.entries()) {
      const item = node('span',undefined,'legend-item'); item.append(swatch(palettes[index]),node('span',label));legend.append(item);
    }
    if (!rows.some(row => metrics.some(([metric]) => row.metric === metric))) {empty(trend);return;}
    const dates = days(selection.from, selection.to);
    const series = metrics.map(([metric,label],index) => ({label,color:palettes[index],values:dates.map(date => sum(rows.filter(row => row.day === date),metric))}));
    const width = Math.max(300, trend.clientWidth || 860), height = 280;
    const left = 46, right = width - 14, top = 12, bottom = 242;
    const maximum = Math.max(1,...series.flatMap(series => series.values.filter(value => value !== null)));
    const ceiling = Math.ceil(maximum / Math.pow(10,Math.floor(Math.log10(maximum)))) * Math.pow(10,Math.floor(Math.log10(maximum)));
    const x = index => dates.length === 1 ? (left + right) / 2 : left + index * (right-left)/(dates.length-1);
    const y = value => bottom - value * (bottom-top)/ceiling;
    const svg = svgNode('svg',{viewBox:'0 0 ' + width + ' ' + height,role:'img','aria-label':document.querySelector('#trend-title').textContent + ' by UTC day'});
    svg.append(svgNode('title',{},'Released daily aggregates. Missing values are gaps.'),svgNode('desc',{},'Use Tab to inspect individual data points. Dates use UTC.'));
    for (let tick=0;tick<=4;tick++) {
      const value = ceiling*tick/4, lineY=y(value);
      svg.append(svgNode('line',{x1:left,x2:right,y1:lineY,y2:lineY,stroke:'var(--grid)','stroke-dasharray':'3 5'}),svgNode('text',{x:left-10,y:lineY+4,'text-anchor':'end',fill:'var(--muted)','font-size':10},compact(value)));
    }
    const count = Math.min(dates.length,Math.max(2,Math.floor(width/140)));
    const indices = new Set(Array.from({length:count},(_,index)=>count===1?0:Math.round(index*(dates.length-1)/(count-1))));
    for (const index of indices) svg.append(svgNode('text',{x:x(index),y:height-10,'text-anchor':index===0?'start':index===dates.length-1?'end':'middle',fill:'var(--muted)','font-size':11},labelDate(dates[index])));
    const defs = svgNode('defs');svg.append(defs);
    for (const [seriesIndex,seriesItem] of series.entries()) {
      const gradientId = 'trend-gradient-' + seriesIndex;
      const gradient = svgNode('linearGradient',{id:gradientId,x1:0,y1:0,x2:0,y2:1});
      gradient.append(svgNode('stop',{offset:'0%','stop-color':seriesItem.color,'stop-opacity':'.22'}),svgNode('stop',{offset:'100%','stop-color':seriesItem.color,'stop-opacity':'.01'}));defs.append(gradient);
      let segment=[];
      const draw = () => {
        if (!segment.length) return;
        const path = segment.map(([px,py],index)=>(index?'L':'M')+px+','+py).join(' ');
        if (segment.length>1) svg.append(svgNode('path',{d:path+' L'+segment.at(-1)[0]+','+bottom+' L'+segment[0][0]+','+bottom+' Z',fill:'url(#'+gradientId+')','aria-hidden':'true'}));
        svg.append(svgNode('path',{d:path,fill:'none',stroke:seriesItem.color,'stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round','aria-label':seriesItem.label + ' released segment'}));segment=[];
      };
      seriesItem.values.forEach((value,index)=>{if(value===null){draw();return;}segment.push([x(index),y(value)]);});draw();
    }
    for (const seriesItem of series) seriesItem.values.forEach((value,index)=>{
      if(value===null)return;
      const point=svgNode('circle',{cx:x(index),cy:y(value),r:3.5,fill:'var(--surface)',stroke:seriesItem.color,'stroke-width':2,class:'chart-point'});
      const description=labelDate(dates[index])+' (UTC) · '+seriesItem.label+': '+number(value);
      point.append(svgNode('title',{},description));describePoint(point,description);svg.append(point);
    });
    trend.replaceChildren(svg);
  }
  function renderRanking(rows) {
    const metrics=measures[measure.value];
    const primary=metrics.find(([metric])=>rows.some(row=>row.metric===metric)) || metrics[0];
    const target=document.querySelector('#ranking');
    const dimension=form.elements.dimension.selectedOptions[0].textContent.toLowerCase();
    document.querySelector('#breakdown-title').textContent=primary[1]+' by '+dimension;
    document.querySelector('#ranking-unit').textContent='Released totals';
    const categories=[...new Set(rows.map(row=>row.value))];
    const values=categories.map(category=>({category,value:sum(rows.filter(row=>row.value===category),primary[0])})).filter(item=>item.value!==null).sort((a,b)=>b.value-a.value || a.category.localeCompare(b.category));
    if(!values.length){empty(target);return;}
    target.replaceChildren();const maximum=Math.max(1,values[0].value);
    for(const [index,item] of values.slice(0,8).entries()){
      const row=node('div',undefined,'rank-row'),label=node('div',undefined,'rank-label'),track=node('div',undefined,'rank-track'),fill=node('div',undefined,'rank-fill');
      label.append(node('span',item.category),node('strong',number(item.value)));
      fill.style.width=(100*item.value/maximum)+'%';fill.style.opacity=String(1-index*.07);track.append(fill);row.append(label,track);target.append(row);
    }
    if(values.length>8)target.append(node('p','Showing 8 of '+values.length+' released categories.','chart-note'));
  }
  function renderOutcomes(rows) {
    const feature=measure.value==='features';
    document.querySelector('#outcome-title').textContent=feature?'Released feature outcomes':'Released turn outcomes';
    const metrics=feature?measures.features.slice(1):measures.turns.slice(1);
    const target=document.querySelector('#outcomes');
    const values=metrics.map(([metric,label],index)=>({label,color:['var(--green)','var(--accent)','var(--amber)','var(--purple)'][index],value:sum(rows,metric)}));
    const released=values.filter(item=>item.value!==null),total=released.reduce((total,item)=>total+item.value,0);
    if(!released.length || !total){empty(target,'Outcomes unavailable','There are no non-zero released outcomes for this selection.');return;}
    const wrap=node('div',undefined,'donut-wrap'),legend=node('div',undefined,'outcome-legend');
    const svg=svgNode('svg',{viewBox:'0 0 180 180',class:'donut',role:'img','aria-label':'Released outcomes: '+number(total)});
    svg.append(svgNode('title',{},'Share of released outcomes only. Withheld outcomes are unavailable.'));
    svg.append(svgNode('circle',{cx:90,cy:90,r:68,fill:'none',stroke:'var(--grid)','stroke-width':18}));
    let offset=0;const circumference=2*Math.PI*68;
    for(const item of values){
      const entry=node('div',undefined,'outcome-row'),name=node('span',undefined,'legend-item');name.append(swatch(item.color),node('span',item.label));
      entry.append(name,node('strong',item.value===null?'—':Math.round(item.value/total*100)+'%'),node('span',number(item.value),'muted'));legend.append(entry);
      if(item.value===null || !item.value)continue;
      const length=item.value/total*circumference;
      const arc=svgNode('circle',{cx:90,cy:90,r:68,fill:'none',stroke:item.color,'stroke-width':18,'stroke-dasharray':length+' '+circumference,'stroke-dashoffset':-offset,transform:'rotate(-90 90 90)'});
      arc.append(svgNode('title',{},item.label+': '+number(item.value)));svg.append(arc);offset+=length;
    }
    svg.append(svgNode('text',{x:90,y:88,'text-anchor':'middle',fill:'var(--text)','font-size':26,'font-weight':600},compact(total)),svgNode('text',{x:90,y:108,'text-anchor':'middle',fill:'var(--muted)','font-size':11},'released'));
    wrap.append(svg,legend);target.replaceChildren(wrap);
  }
  function renderTables(data) {
    const summary=document.querySelector('#summary'),rows=document.querySelector('#rows');summary.replaceChildren();rows.replaceChildren();
    for(const row of data.summary){
      const tr=node('tr');for(const value of [row.day,row.category,number(row.started),number(row.completed),number(row.failed),number(row.interrupted),number(row.input),number(row.output),number(row.measured)+' / '+number(row.terminal),row.modelShare===null?'Unavailable':row.modelShare+'%',row.featureSuccess===null?'Unavailable':row.featureSuccess+'% ('+row.featureResolved+')'])tr.append(node('td',value));summary.append(tr);
    }
    for(const row of data.rows){const tr=node('tr');for(const value of [row.day,row.metric,row.value,number(row.total),number(row.reports)])tr.append(node('td',value));rows.append(tr);}
  }
  function renderBehavior() {
    const target=document.querySelector('#behavior-charts');target.replaceChildren();
    const all=current?.behavior || [],models=all.filter(row=>row.model!=='unknown' && row.model!=='custom');
    document.querySelector('#behavior-coverage').textContent=models.length?models.length+' attributed model categories. Each chart uses its own matched samples; missing measurements stay unavailable.':'No attributed model measurements for this selection. Unknown execution models are never inferred from settings.';
    for(const [id,title,unit,sampleUnit] of behaviorMeasures){
      const card=node('article',undefined,'panel behavior-card');card.id='behavior-'+id;const heading=node('h3',title);heading.id=card.id+'-title';card.setAttribute('aria-labelledby',heading.id);card.append(heading,node('p',unit,'muted'));
      const measured=models.filter(model=>model.metrics[id].value!==null).sort((a,b)=>b.metrics[id].value-a.metrics[id].value || a.model.localeCompare(b.model));
      if(!measured.length){const body=node('div');empty(body,'Unavailable','No matching released measurements for this metric.');card.append(body);}
      else{
        const maximum=Math.max(1,...measured.map(model=>model.metrics[id].value));
        for(const model of measured.slice(0,12)){
          const metric=model.metrics[id],row=node('div',undefined,'rank-row'),label=node('div',undefined,'rank-label');
          const value=new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(metric.value)+(unit==='%'?'%':'');
          label.append(node('span',model.model),node('strong',value));
          const track=node('div',undefined,'rank-track'),fill=node('div',undefined,'rank-fill');fill.style.width=100*metric.value/maximum+'%';track.append(fill);
          row.append(label,track,node('p',number(metric.samples)+' '+sampleUnit+' · '+metric.days+' UTC days','sample'));card.append(row);
        }
      }
      const unavailable=models.filter(model=>model.metrics[id].value===null);
      if(unavailable.length)card.append(node('p','Unavailable: '+unavailable.map(model=>model.model).join(', '),'chart-note'));
      target.append(card);
    }
  }
  function render() {
    const rows=current?.rows || [];tooltip.hidden=true;
    renderCards(rows);renderTrend(rows);renderRanking(rows);renderOutcomes(rows);renderBehavior();
  }
  function setPeriod(length) {
    period=length;
    const end=Date.now()-(isDevelopment()?0:86400000);
    form.elements.from.value=day(end-(length-1)*86400000);form.elements.to.value=day(end);
    for(const button of document.querySelectorAll('[data-days]'))button.setAttribute('aria-pressed',String(Number(button.dataset.days)===length));
  }
  async function load(background = false) {
    const ownGeneration=++generation;controller?.abort();controller=new AbortController();
    if(!background){authenticated=true;current=null;selection={from:form.elements.from.value,to:form.elements.to.value};render();renderTables({rows:[],summary:[]});status.textContent='Loading aggregates…';}
    status.classList.remove('error');trend.setAttribute('aria-busy','true');
    const params=new URLSearchParams(new FormData(form));if(view==='behavior')params.set('dimension','model');if(!params.get('value'))params.delete('value');
    try{
      const response=await fetch('/v1/telemetry/metrics?'+params,{credentials:'same-origin',signal:controller.signal});
      if(!response.ok){if(response.status===401)authenticated=false;throw Error(response.status===401?'Operator authentication required.':'Could not load aggregates.');}
      const data=await response.json();if(ownGeneration!==generation)return;
      current=data;document.querySelector('#coverage').textContent=data.coverage;
      status.textContent=isDevelopment()
        ? 'Development · '+(data.rows.length?'Exact observed counts, including today.':'No development reports for these filters yet.')+' Refreshes every 5 seconds.'
        : (data.rows.length?'Partial aggregate data.':'No released data for these filters.')+' Updated '+data.updatedAt+' · UTC days · bins of ten';
      render();renderTables(data);
    }catch(error){if(ownGeneration!==generation)return;current=null;render();renderTables({rows:[],summary:[]});status.classList.add('error');status.textContent=error.name==='AbortError'?'Request cancelled.':error.message;}
    finally{if(ownGeneration===generation)trend.setAttribute('aria-busy','false');}
  }
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
    view=button.dataset.view;document.querySelector('#usage-view').hidden=view!=='usage';document.querySelector('#behavior-view').hidden=view!=='behavior';
    for(const tab of document.querySelectorAll('[data-view]'))tab.setAttribute('aria-pressed',String(tab===button));
    form.elements.dimension.disabled=view==='behavior';if(view==='behavior')form.elements.dimension.value='model';
    void load();
  });
  form.addEventListener('submit',event=>{event.preventDefault();void load();});
  for(const button of document.querySelectorAll('[data-days]'))button.addEventListener('click',()=>{setPeriod(Number(button.dataset.days));void load();});
  form.elements.dimension.addEventListener('change',()=>{measure.value=form.elements.dimension.value==='feature'?'features':'tokens';void load();});
  form.elements.environment.addEventListener('change',()=>{setPeriod(period);measure.value=isDevelopment()?'turns':'tokens';void load();});
  for(const field of [form.elements.from,form.elements.to])field.addEventListener('change',()=>{for(const button of document.querySelectorAll('[data-days]'))button.setAttribute('aria-pressed','false');});
  measure.addEventListener('change',render);
  let resizeFrame;
  addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(current)renderTrend(current.rows);});});
  setInterval(()=>{if(isDevelopment() && authenticated && !document.hidden && trend.getAttribute('aria-busy')!=='true')void load(true);},5000);
  setPeriod(7);void load();
})();
`;
