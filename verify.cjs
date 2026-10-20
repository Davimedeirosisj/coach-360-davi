const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=fs.existsSync(__dirname+'/dist/app.js')?__dirname+'/dist':__dirname;
const source=fs.readFileSync(base+'/app.js','utf8');
function boot(seed,{time=Date.now()}={}){
 const elements=new Map(),storage=new Map(seed?[['coach360-davi-v1',JSON.stringify(seed)]]:[]),events={},clock={now:time},flags={fail:false};
 const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',style:{},value:'',checked:false,hidden:true,open:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(key);};
 class TestDate extends Date{static now(){return clock.now;}}
 class TestFormData{constructor(form){this.data=Object.entries(form.fields||{});}[Symbol.iterator](){return this.data[Symbol.iterator]();}get(key){return this.data.find(x=>x[0]===key)?.[1]??null;}}
 const sandbox={console,Intl,Date:TestDate,JSON,Math,Number,String,Array,Object,Boolean,Map,crypto:require('node:crypto').webcrypto,structuredClone,FormData:TestFormData,location:{hash:''},document:{querySelector:element,visibilityState:'visible',addEventListener:(e,f)=>{events[e]=f;}},window:{addEventListener:(e,f)=>{events[e]=f;}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(flags.fail)throw Error('QuotaExceededError');storage.set(k,v);}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},confirm:()=>true};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const run=s=>vm.runInContext(s,sandbox),submit=(id,fields={})=>element(id).onsubmit({preventDefault(){},target:{fields}});
 return {run,submit,storage,elements,element,sandbox,events,clock,flags};
}
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('blank profile and valid empty backup',()=>{
 const b=boot();assert.equal(b.run('state.profile.name'),'');assert.equal(b.run('state.profile.weight'),null);assert.equal(b.run('state.profile.calories'),null);
 assert.match(b.element('#app').innerHTML,/Configurar meu perfil/);assert.doesNotThrow(()=>b.run('validateBackup(JSON.parse(JSON.stringify(state)))'));
});
test('legacy profile and records are preserved',()=>{
 const legacy={version:1,profile:{name:'Teste legado',age:40,height:170,weight:80,calories:2000,protein:100,carbs:200,fat:60},checks:{},foods:[],sessions:[],assessment:null,started:'2026-10-20'};
 const b=boot(legacy);assert.equal(b.run('state.profile.completed'),true);assert.equal(b.run('state.profile.weight'),80);assert.doesNotThrow(()=>b.run('validateBackup(JSON.parse(JSON.stringify(state)))'));
});
test('no calorie goal produces a neutral ring; zero sleep stays zero',()=>{
 const b=boot();b.run("state.profile.name='QA';state.profile.completed=true;state.foods=[{date:today(),kcal:150,p:1,c:1,g:1}];state.checks[today()]={date:today(),sleep:0};home()");
 const html=b.element('#app').innerHTML;assert.match(html,/--p:0/);assert.match(html,/sem meta definida/);assert.match(html,/>0 <small>horas/);assert.match(html,/Informado no check-in/);assert.doesNotMatch(html,/NaN|Infinity|Ainda não registrado/);
 b.run('state.profile.calories=300;home()');assert.match(b.element('#app').innerHTML,/--p:50/);
});
test('failed check-in preserves form and stored state; retry saves once',()=>{
 const b=boot();b.run('checkin()');const before=b.element('#app').innerHTML,fields={date:'2026-10-20',weight:'',waist:'',sleep:'0',energy:'5',hunger:'5',pain:'nao',notes:'QA'};
 b.flags.fail=true;b.submit('#check-form',fields);assert.match(b.element('#toast').textContent,/Alteração não salva/);assert.equal(b.element('#storage-error').hidden,false);assert.equal(b.run('Object.keys(state.checks).length'),0);assert.equal(b.element('#app').innerHTML,before);
 b.flags.fail=false;b.submit('#check-form',fields);assert.equal(b.run('Object.keys(state.checks).length'),1);assert.equal(b.run("state.checks['2026-10-20'].sleep"),0);assert.equal(b.element('#toast').textContent,'Check-in salvo.');assert.equal(b.element('#storage-error').hidden,true);
});
test('cardio failure keeps modal and retry does not duplicate',()=>{
 const b=boot();b.run('cardio()');const fields={date:'2026-10-20',duration:'20',effort:'4'};
 b.flags.fail=true;b.submit('#cardio-form',fields);assert.equal(b.run('state.sessions.length'),0);assert.equal(b.element('#modal').open,true);assert.equal(b.element('#modal-storage-error').hidden,false);
 b.flags.fail=false;b.submit('#cardio-form',fields);assert.equal(b.run('state.sessions.length'),1);assert.equal(b.element('#modal').open,false);
});
test('food additions and favorites use transactional saves',()=>{
 const b=boot();b.run('foodForm()');b.element('#food-choice').value='custom';
 const fields={name:'QA',meal:'Almoço',grams:'100',kcal:'150',p:'10',c:'20',g:'3'};
 b.flags.fail=true;b.submit('#food-form',fields);assert.equal(b.run('state.foods.length'),0);
 b.flags.fail=false;b.submit('#food-form',fields);assert.equal(b.run('state.foods.length'),1);
 b.flags.fail=true;b.run('favoriteFood(0)');assert.equal(b.run('state.favorites.length'),0);
 b.flags.fail=false;b.run('favoriteFood(0)');assert.equal(b.run('state.favorites.length'),1);
 b.flags.fail=true;b.run('removeFoodAt(0)');assert.equal(b.run('state.foods.length'),1);
});
test('repeating meals can retry a failed save without duplicates',()=>{
 const b=boot();b.run("state.foods=[{id:uid(),date:today(),name:'QA',meal:'Almoço',grams:100,kcal:150,p:10,c:20,g:3}];repeatMeal()");
 b.element('#repeat-choice').value='0';b.element('#repeat-target').value='Jantar';
 b.flags.fail=true;b.submit('#repeat-form');assert.equal(b.run('state.foods.length'),1);
 b.flags.fail=false;b.submit('#repeat-form');assert.equal(b.run('state.foods.length'),2);
});
function draft(b){b.run("session={id:uid(),date:today(),type:'A',start:Date.now(),elapsedMs:0,segmentStarted:Date.now(),running:true,index:0,exercises:routines.A.map(key=>({key,sets:[]}))};session.exercises[0].sets=[{reps:9,rir:4},{reps:null,rir:null}];persistSession()");}
test('hidden tab time counts; only explicit pause stops clock',()=>{
 const b=boot(null,{time:1000});draft(b);
 b.clock.now=6000;b.sandbox.document.visibilityState='hidden';b.events.visibilitychange();
 b.clock.now=126000;b.sandbox.document.visibilityState='visible';b.events.visibilitychange();
 b.clock.now=127000;b.run('persistSession()');assert.equal(b.run('session.elapsedMs'),126000);
 b.run('pauseSession()');assert.equal(b.run('state.activeSession.running'),false);assert.equal(b.run('state.activeSession.segmentStarted'),null);
 b.clock.now=227000;b.run('startScreen(true)');b.element('#ready').checked=true;b.run('beginSession()');
 b.clock.now=231000;b.run('persistSession()');assert.equal(b.run('session.elapsedMs'),130000);
});
test('reload keeps series and running elapsed time',()=>{
 const b=boot(null,{time:1000});draft(b);b.clock.now=5000;b.events.pagehide();
 const c=boot(JSON.parse(b.storage.get('coach360-davi-v1')),{time:15000});
 assert.equal(c.run('state.activeSession.exercises[0].sets[0].reps'),9);assert.equal(c.run('state.activeSession.running'),true);
 c.run('startScreen(true)');c.element('#ready').checked=true;c.run('beginSession()');assert.equal(c.run('session.elapsedMs'),14000);
});
test('failed phase save does not advance or lose previous checkpoint',()=>{
 const b=boot(null,{time:1000});draft(b);b.flags.fail=true;b.run('nextPhase(1)');
 assert.equal(b.run('session.index'),0);assert.equal(b.run('state.activeSession.index'),0);
 b.flags.fail=false;b.run('nextPhase(1)');assert.equal(b.run('state.activeSession.index'),1);
});
test('finishing a workout clears draft only after durable save',()=>{
 const b=boot(null,{time:1000});draft(b);b.run("modal('');session.exercises.forEach(x=>x.sets=[{reps:8,rir:4},{reps:8,rir:4}]);session.index=4;sessionView()");
 b.element('#difficulty').value='5';b.element('#session-note').value='QA';
 b.flags.fail=true;b.submit('#finish');assert.equal(b.run('state.sessions.length'),0);assert.ok(b.run('state.activeSession'));assert.equal(b.element('#modal').open,true);
 b.flags.fail=false;b.submit('#finish');assert.equal(b.run('state.sessions.length'),1);assert.equal(b.run('state.activeSession'),null);assert.equal(b.run('session'),null);
});
test('legacy long notes round-trip, new forms share the note limit',()=>{
 const b=boot();b.run("state.assessment={push:'',squat:'',lunge:'',plank:'',pull:'',bar:'nao',notes:'a'.repeat(5000),date:today()};state.profile.healthNotes='b'.repeat(5000)");
 b.run("download=(name,text)=>{window.exported=text;};backup()");
 const exported=b.sandbox.window.exported;assert.equal(JSON.parse(exported).assessment.notes.length,5000);
 assert.equal(b.run('validateBackup(JSON.parse(window.exported)).assessment.notes.length'),5000);
 b.run('assessment()');assert.match(b.element('#modal-content').innerHTML,/id="alim" name="notes" maxlength="2000"/);
});
test('imported drafts are paused and invalid records rejected',()=>{
 const b=boot();draft(b);
 assert.equal(b.run('validateBackup(JSON.parse(JSON.stringify(state))).activeSession.running'),false);
 assert.throws(()=>b.run("const bad=JSON.parse(JSON.stringify(state));bad.activeSession.exercises[0].sets[0].reps='<script>';validateBackup(bad)"));
 assert.throws(()=>b.run("const bad2=JSON.parse(JSON.stringify(state));bad2.activeSession.id=\"x');alert(1)//\";validateBackup(bad2)"));
});
test('portion arithmetic and public profile privacy',()=>{
 const b=boot();assert.equal(b.run('foods[2][2]*(portionUnits[2][0].grams*2/foods[2][1])'),152);
 assert.doesNotMatch(source,/age:33|height:174|weight:112|Exames de julho|trabalho sentado|sem álcool|sono habitual informado/);
 assert.doesNotMatch(fs.readFileSync(base+'/index.html','utf8'),/Davi|Medeiros/);
});
console.log(passed+' checks passed.');
