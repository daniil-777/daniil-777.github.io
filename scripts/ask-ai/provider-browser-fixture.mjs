/** Isolated browser test doubles. Never call a paid provider or download model files. */
export const providerFixture = String.raw`
window.__qa={provider:'ok',calls:[],prompts:[],workers:[],errors:[],csp:[]};
addEventListener('error',e=>__qa.errors.push(e.message));
addEventListener('unhandledrejection',e=>__qa.errors.push(String(e.reason)));
document.addEventListener('securitypolicyviolation',e=>__qa.csp.push(e.effectiveDirective+':'+e.blockedURI));
localStorage.clear();sessionStorage.clear();
const realFetch=window.fetch.bind(window);
const sse=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';
window.fetch=async (input,init)=>{
 const url=String(input);
 if(!/\/v1\/chat$/.test(url)) return realFetch(input,init);
 const request=JSON.parse(init.body);__qa.calls.push(request);
 if(__qa.provider==='credits-http') return Response.json({error:{code:'credits'}},{status:503});
 if(__qa.provider==='budget') return Response.json({error:{code:'budget'}},{status:429});
 if(__qa.provider==='rate') return Response.json({error:{code:'rate'}},{status:429});
 let text='Overfitting means learning training data too closely and generalizing poorly to unseen data.',cites=[];
 if(request.q.includes('Public portfolio topic:')) {
  const kb=await realFetch('/chat/kb.json').then(r=>r.json());
  const title=request.q.split('Public portfolio topic: ')[1];
  const c=kb.chunks.find(c=>c.title===title&&c.kind==='project');
  if(c){text=c.text;cites=[c.id];}
 }
 let result=sse('status',{});
 if(__qa.provider==='credits-stream') result+=sse('block',{t:'This partial cloud answer must disappear.',c:[]})+sse('error',{code:'credits'});
 else result+=sse('block',{t:text,c:cites})+sse('done',{stop:'end_turn'});
 return new Response(result,{headers:{'content-type':'text/event-stream'}});
};
const scenario=location.hash;
if(scenario.includes('saved-device')) localStorage.setItem('chat:mode:v3','device');
if(scenario.includes('builtin')||scenario.includes('delayed')) {
 let availabilityCalls=0;
 window.LanguageModel={availability:async()=>{
   availabilityCalls++;
   if(scenario.includes('delayed')&&availabilityCalls===1) await new Promise(resolve=>__qa.probeReady=resolve);
   return 'available';
 },create:async()=>({clone:async()=>({promptStreaming(prompt){
   __qa.prompts.push(prompt);
   return new ReadableStream({start(c){c.enqueue('For example, a model can memorize its training data and then fail on unseen examples.');c.close();}});
 },destroy(){}})})};
}
if(scenario.includes('download')) {
 Object.defineProperty(navigator,'deviceMemory',{value:8,configurable:true});
 Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({features:{has:()=>false}})},configurable:true});
 navigator.storage.estimate=async()=>({quota:10_000_000_000,usage:0});
 window.Worker=class extends EventTarget {
  constructor(){super();__qa.workers.push(this);this.dead=false;}
  reply(data){if(!this.dead)this.dispatchEvent(new MessageEvent('message',{data}));}
  postMessage(m){
   if(m.type==='llm-load'){this.loading=true;return;}
   if(m.type==='generate') {__qa.prompts.push(m.prompt);queueMicrotask(()=>{
     this.reply({type:'token',id:m.id,text:'Overfitting means learning training data too closely and generalizing poorly to unseen data.'});
     this.reply({type:'end',id:m.id});
   });}
  }
  terminate(){this.dead=true;}
 };
 __qa.release=()=>__qa.workers.forEach(w=>w.reply({type:'ready'}));
}
`;
