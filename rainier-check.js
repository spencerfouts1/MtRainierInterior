
(() => {
  const root = document.getElementById('rainier-quakes');
  const error = root.querySelector('.rq-error');
  if (!window.d3 || !window.Plotly) {
    error.hidden = false;
    error.textContent = 'The chart library could not load. Reopen this view with an internet connection.';
    return;
  }
  const raw = JSON.parse(document.getElementById('rainier-event-data').textContent);
  const KM_PER_MILE = 1.609344;
  // Geometry remains in kilometers; tick positions convert integer miles to km.
  // A descending depth range puts negative depths above sea level without negating the data.
  function mileTicks(range) {
    const miles = d3.range(Math.ceil(range[0]/KM_PER_MILE),Math.floor(range[1]/KM_PER_MILE)+1);
    return {tickmode:'array',tickvals:miles.map(m=>m*KM_PER_MILE),ticktext:miles.map(String)};
  }
  function seaSide(depth) { return depth<0?'above sea level':depth>0?'below sea level':'at sea level'; }
  // Spherical azimuthal equidistant projection centered on the USGS summit position.
  // D3 scale is mean Earth radius in km; screen north is negated for geographic north.
  const projection = d3.geoAzimuthalEquidistant().rotate([121.76,-46.853]).translate([0,0]).scale(6371.0088);
  const events = raw.map(r => {
    const p = projection([r[1],r[2]]);
    return {id:r[0],lon:r[1],lat:r[2],depth:r[3],mag:r[4],t:r[5],x:p[0],y:-p[1],radius:Math.hypot(p[0],p[1])};
  }).sort((a,b)=>a.t-b.t);
  const startDay = '2024-09-26', endDay = '2026-09-24';
  const defaults = {view:'3d',area:'all',color:'depth',start:startDay,end:endDay,mag:'-0.7'};
  const controls = Object.fromEntries([...root.querySelectorAll('[data-control]')].map(el=>[el.dataset.control,el]));
  let state={...defaults},selected=null,camera=null,ready=false,busy=false,pending=false;
  const plot = root.querySelector('.rq-plot');
  const status = root.querySelector('.rq-status');
  const detail = root.querySelector('.rq-detail');
  const timeExtent = d3.extent(events,d=>d.t);
  const depthExtent = d3.extent(events,d=>d.depth);
  const dates = d3.utcFormat('%b %d, %Y');
  const monthStarts = d3.utcMonth.range(d3.utcMonth.floor(new Date(timeExtent[0])),d3.utcMonth.offset(d3.utcMonth.floor(new Date(timeExtent[1])),1));
  const allCounts = d3.rollup(events,v=>v.length,d=>+d3.utcMonth.floor(new Date(d.t)));
  const probe=document.createElement('span'); probe.hidden=true;root.appendChild(probe);
  function cssColor(name) {probe.style.color='var('+name+')';return d3.color(getComputedStyle(probe).color).formatRgb();}
  function palette() {return {fg:cssColor('--foreground'),muted:cssColor('--muted-foreground'),border:cssColor('--border'),one:cssColor('--viz-series-1'),two:cssColor('--viz-series-2'),pop:cssColor('--popover'),popfg:cssColor('--popover-foreground')};}
  function restore(saved) {
    const s=saved?.modelContent?.filters;
    if(s) for(const k of ['view','area','color','mag']) if([...controls[k].options].some(o=>o.value===String(s[k]))) state[k]=String(s[k]);
    if(s) for(const k of ['start','end']) if(/^\d{4}-\d{2}-\d{2}$/.test(s[k]) && s[k]>=startDay && s[k]<=endDay) state[k]=s[k];
    if(state.start>state.end) {state.start=startDay;state.end=endDay;}
    for(const k in controls)controls[k].value=state[k];
    const c=saved?.privateContent?.camera;
    if(c?.eye && ['x','y','z'].every(k=>Number.isFinite(c.eye[k])))camera=c;
    const id=saved?.modelContent?.selectedEvent?.id;
    selected=events.find(e=>e.id===id)||null;
  }
  function save() {
    const entry=selected?{id:selected.id,latitude:selected.lat,longitude:selected.lon,depthKm:selected.depth,depthMiles:selected.depth/KM_PER_MILE,magnitude:selected.mag,timeUTC:new Date(selected.t).toISOString()}:null;
    if(window.openai?.setWidgetState)window.openai.setWidgetState({modelContent:{dataset:'Mount Rainier earthquake export: 2468 events, 2024-09-26 through 2026-09-24',filters:{...state},selectedEvent:entry},privateContent:{camera}}).catch(()=>{});
  }
  function showDetail() {
    detail.textContent=selected?`Event ${selected.id} · ${new Date(selected.t).toISOString().replace('T',' ').replace('Z',' UTC')} · M ${selected.mag.toFixed(2)} · depth ${(selected.depth/KM_PER_MILE).toFixed(2)} mi (${seaSide(selected.depth)}) · ${selected.lat.toFixed(5)}°, ${selected.lon.toFixed(5)}°`:'Select an earthquake for its time, location, depth, and magnitude.';
  }
  function filtered() {
    const a=Date.parse(state.start+'T00:00:00Z'), b=Date.parse(state.end+'T00:00:00Z')+86400000;
    return events.filter(d=>d.t>=a&&d.t<b&&d.mag>=+state.mag&&(state.area==='all'||d.radius<=+state.area));
  }
  function padded(values) {
    const [a,b]=d3.extent(values),p=Math.max((b-a)*.12,1);return[a-p,b+p];
  }
  function monthly(shown,colors) {
    const svg=d3.select(root.querySelector('.rq-months')),w=svg.node().getBoundingClientRect().width,h=174;
    const m={l:64,r:12,t:12,b:47};
    svg.attr('viewBox',`0 0 ${w} ${h}`);svg.selectAll('*').remove();
    const x=d3.scaleUtc().domain([monthStarts[0],d3.utcMonth.offset(monthStarts.at(-1),1)]).range([m.l,w-m.r]);
    const y=d3.scaleLinear().domain([0,d3.max(allCounts.values())*1.08]).nice().range([h-m.b,m.t]);
    const counts=d3.rollup(shown,v=>v.length,d=>+d3.utcMonth.floor(new Date(d.t)));
    svg.append('rect').attr('data-chart-frame','').attr('x',m.l).attr('y',m.t).attr('width',Math.max(1,w-m.l-m.r)).attr('height',h-m.b-m.t).attr('fill','none').attr('stroke',colors.border);
    for(const date of monthStarts) {
      const bx=x(date)+1,bw=Math.max(1,x(d3.utcMonth.offset(date,1))-x(date)-2),total=allCounts.get(+date)||0,n=counts.get(+date)||0;
      svg.append('rect').attr('x',bx).attr('y',y(total)).attr('width',bw).attr('height',y(0)-y(total)).attr('fill',colors.one).attr('opacity',.17);
      svg.append('rect').attr('x',bx).attr('y',y(n)).attr('width',bw).attr('height',y(0)-y(n)).attr('fill',colors.one);
      svg.append('rect').attr('x',bx).attr('y',m.t).attr('width',bw).attr('height',h-m.b-m.t).attr('fill','transparent').attr('data-chart-hit','').attr('data-tooltip',`${d3.utcFormat('%B %Y')(date)}: ${n.toLocaleString()} selected / ${total.toLocaleString()} total`);
    }
    const ticks=w<440?3:5;
    svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).ticks(ticks).tickFormat(d3.utcFormat('%b %Y')).tickSizeOuter(0));
    svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickFormat(d3.format('~s')).tickSizeOuter(0));
    svg.append('text').attr('class','axis-title').attr('data-axis','x').attr('x',(m.l+w-m.r)/2).attr('y',h-6).attr('text-anchor','middle').text('Month (UTC)');
    svg.append('text').attr('class','axis-title').attr('data-axis','y').attr('transform',`translate(15,${(m.t+h-m.b)/2}) rotate(-90)`).attr('text-anchor','middle').text('Earthquakes');
    const tickText=svg.selectAll('.tick text').nodes();
    tickText.forEach(t=>{const box=t.getBoundingClientRect(),outer=svg.node().getBoundingClientRect();if(box.right>outer.right-4)t.setAttribute('text-anchor','end');if(box.left<outer.left+4)t.setAttribute('text-anchor','start');});
  }
  async function draw() {
    if(busy){pending=true;return;}busy=true;root.dataset.ready='false';
    try {
      const shown=filtered(),colors=palette(),width=plot.getBoundingClientRect().width;
      status.textContent=`${shown.length.toLocaleString()} of 2,468 events · ${dates(new Date(state.start+'T00:00Z'))}–${dates(new Date(state.end+'T00:00Z'))} · ${state.view==='3d'?'Drag to rotate; scroll to zoom':'All selected points projected into this plane'}`;
      if(selected&&!shown.some(d=>d.id===selected.id))selected=null;
      showDetail();monthly(shown,colors);
      const spatial=events.filter(d=>state.area==='all'||d.radius<=+state.area);
      const xr=padded([...spatial.map(d=>d.x),0]),yr=padded([...spatial.map(d=>d.y),0]);
      const zr=padded([...spatial.map(d=>d.depth),-4.392,0]);
      const colorValues=shown.map(d=>state.color==='time'?d.t:d.depth);
      const cextent=state.color==='time'?[Date.parse(state.start+'T00:00:00Z'),Date.parse(state.end+'T00:00:00Z')+86399999]:depthExtent;
      const colorTicks=state.color==='time'?[cextent[0],(cextent[0]+cextent[1])/2,cextent[1]]:mileTicks(depthExtent).tickvals;
      const colorText=state.color==='time'?colorTicks.map(t=>d3.utcFormat(cextent[1]-cextent[0]<100*86400000?'%b %d':'%b %Y')(new Date(t))):colorTicks.map(d=>String(Math.round(d/KM_PER_MILE)));
      const marker={size:shown.map(d=>2.2+(d.mag+.7)*2),color:colorValues,colorscale:[[0,colors.one],[1,colors.two]],cmin:cextent[0],cmax:cextent[1],opacity:.82,showscale:true,line:{width:0},colorbar:{orientation:'h',x:.5,xanchor:'center',y:1.02,yanchor:'bottom',len:.72,thickness:9,outlinewidth:0,tickvals:colorTicks,ticktext:colorText,tickfont:{color:colors.fg,size:12},title:{text:state.color==='time'?'Date (UTC)':'Depth from sea level (miles)',side:'top',font:{color:colors.fg,size:12}}}};
      const custom=shown.map(d=>[d.id,new Date(d.t).toISOString().replace('T',' ').replace('Z',' UTC'),d.mag.toFixed(2),(d.depth/KM_PER_MILE).toFixed(2),d.lat.toFixed(5),d.lon.toFixed(5),seaSide(d.depth)]);
      const hover='Event %{customdata[0]}<br>%{customdata[1]}<br>M %{customdata[2]} · depth %{customdata[3]} mi<br>%{customdata[6]}<br>%{customdata[4]}°, %{customdata[5]}°<extra></extra>';
      const axisBase={color:colors.fg,gridcolor:colors.border,zerolinecolor:colors.border,linecolor:colors.border,showbackground:false,tickfont:{size:12},nticks:width<440?3:5,showspikes:false};
      const base={width,height:plot.clientHeight,paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:colors.fg,family:getComputedStyle(root).fontFamily,size:12},margin:{l:0,r:0,t:68,b:48},showlegend:false,hoverlabel:{bgcolor:colors.pop,bordercolor:colors.border,font:{color:colors.popfg}},uirevision:state.view+'-'+state.area};
      let traces,layout;
      if(state.view==='3d') {
        traces=[{type:'scatter3d',mode:'markers',x:shown.map(d=>d.x),y:shown.map(d=>d.y),z:shown.map(d=>d.depth),customdata:custom,marker,hovertemplate:hover,name:'Earthquakes'},
          {type:'scatter3d',mode:'markers+text',x:[0],y:[0],z:[-4.392],text:['Rainier'],textposition:'top center',textfont:{color:colors.fg,size:12},marker:{symbol:'diamond',size:6,color:colors.fg},hovertemplate:'Mount Rainier summit<br>46.853° N, 121.760° W<br>2.729 miles above sea level<extra></extra>',name:'Summit'},
          {type:'scatter3d',mode:'lines',x:[0,0],y:[0,0],z:[-4.392,0],line:{color:colors.muted,width:2,dash:'dot'},hoverinfo:'skip',name:'Summit to sea level'},
          {type:'scatter3d',mode:'lines+text',x:[xr[0],xr[1],xr[1],xr[0],xr[0]],y:[yr[0],yr[0],yr[1],yr[1],yr[0]],z:[0,0,0,0,0],text:['','','Sea level (0 mi)','',''],textposition:'top left',textfont:{color:colors.fg,size:12},line:{color:colors.muted,width:2},hoverinfo:'skip',name:'Sea level'}];
        layout={...base,scene:{xaxis:{...axisBase,title:{text:width<500?'East (km)':'East of summit (km)'},range:xr},yaxis:{...axisBase,title:{text:width<500?'North (km)':'North of summit (km)'},range:yr},zaxis:{...axisBase,...mileTicks(zr),title:{text:'Depth (miles)'},range:[zr[1],zr[0]]},aspectmode:'manual',aspectratio:{x:(width<500?1:1.45)*(xr[1]-xr[0])/Math.max(xr[1]-xr[0],yr[1]-yr[0],zr[1]-zr[0]),y:(width<500?1:1.45)*(yr[1]-yr[0])/Math.max(xr[1]-xr[0],yr[1]-yr[0],zr[1]-zr[0]),z:(width<500?1:1.45)*(zr[1]-zr[0])/Math.max(xr[1]-xr[0],yr[1]-yr[0],zr[1]-zr[0])},dragmode:'orbit',camera:camera||{eye:width<500?{x:1.9,y:-2.2,z:1.3}:{x:1.45,y:-1.7,z:.95},up:{x:0,y:0,z:1},projection:{type:'orthographic'}},bgcolor:'rgba(0,0,0,0)'}};
      } else {
        const east=state.view==='ew';
        marker.size=shown.map(d=>3+(d.mag+.7)*2.2);
        traces=[{type:'scatter',mode:'markers',x:shown.map(d=>east?d.x:d.y),y:shown.map(d=>d.depth),customdata:custom,marker,hovertemplate:hover,name:'Earthquakes'},
          {type:'scatter',mode:'markers+text',x:[0],y:[-4.392],text:['Rainier'],textposition:'top center',cliponaxis:false,marker:{symbol:'diamond',size:9,color:colors.fg},hovertemplate:'Mount Rainier summit · 2.729 miles above sea level<extra></extra>',name:'Summit'}];
        layout={...base,margin:{l:64,r:16,t:80,b:48},xaxis:{...axisBase,title:{text:east?'East of summit (km)':'North of summit (km)'},range:east?xr:yr,constrain:'domain',showline:true,mirror:true},yaxis:{...axisBase,...mileTicks(zr),title:{text:'Depth from sea level (miles)'},range:[zr[1],zr[0]],scaleanchor:'x',scaleratio:1,constrain:'domain',showline:true,mirror:true},shapes:[{type:'line',xref:'x domain',x0:0,x1:1,y0:0,y1:0,line:{color:colors.muted,width:1,dash:'dot'}}],dragmode:'pan'};
      }
      plot.setAttribute('aria-label',`${state.view==='3d'?'Rotatable 3D earthquake locations':state.view==='ew'?'East-west projection of earthquake locations':'North-south projection of earthquake locations'}; ${shown.length} earthquakes. Depth is labeled in one-mile increments, increasing downward. Negative values lie above the sea-level reference. Equal physical distance scales.`);
      await Plotly.react(plot,traces,layout,{responsive:true,displayModeBar:false,scrollZoom:true,displaylogo:false});
      if(!ready) {
        ready=true;
        plot.on('plotly_click',event=>{const p=event.points[0];if(p?.customdata){selected=events.find(e=>e.id===p.customdata[0]);showDetail();save();}});
        plot.on('plotly_relayout',data=>{if(!busy && data['scene.camera'] && JSON.stringify(camera)!==JSON.stringify(data['scene.camera'])){camera=data['scene.camera'];save();}});
      }
      root.dataset.visibleCount=String(shown.length);root.dataset.ready='true';
    } catch(e) {error.hidden=false;error.textContent='Chart error: '+e.message;}
    finally {busy=false;if(pending){pending=false;draw();}}
  }
  restore(window.openai?.widgetState);
  for(const [key,el] of Object.entries(controls)) el.addEventListener('change',()=>{
    if(!el.value||!el.checkValidity()){error.hidden=false;error.textContent='Choose dates within the catalog range.';return;}
    const next={...state,[key]:el.value};
    if(next.start>next.end){error.hidden=false;error.textContent='The start date must be on or before the end date.';return;}
    error.hidden=true;state=next;if(key==='area')camera=null;save();draw();
  });
  let resizeTimer;
  new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>draw(),140);}).observe(root.querySelector('.rq-plot'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>draw());
  new MutationObserver(()=>draw()).observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  window.addEventListener('openai:set_globals',event=>{
    if(event.detail?.globals?.widgetState){
      const before=JSON.stringify({state,camera,id:selected?.id});
      restore(event.detail.globals.widgetState);
      if(before!==JSON.stringify({state,camera,id:selected?.id}))draw();
    }
  });
  draw();
})();
