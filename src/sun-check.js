import {SUN,solarPosition,sunAvailability,observeShadow,observationValid,correctedHeading} from './sun.js';
import {headingDelta} from './sensors.js';
// Session-only alignment observations. No camera, network, storage or background worker.
export function createSunCheck({getSensors,onChange}){
 const $=id=>document.getElementById(id);
 let observation=null,applied=false,message='',samples=[],timer=0,lastSample=-Infinity,computeMs=0;
 function reset(reason=''){observation=null;applied=false;samples=[];message=reason;}
 function snapshot(){const s=getSensors(),now=Date.now();return {observation,applied:applied&&observationValid(observation,s,now),computeMs,reason:sunAvailability(s,now)};}
 function heading(raw){return correctedHeading(raw,observation,applied,getSensors(),Date.now());}
 function refresh(){
  const s=getSensors(),now=Date.now(),was=applied;
  if(observation&&(!observationValid(observation,s,now)||sunAvailability(s,now)))reset('Previous check expired. Align again when conditions allow.');
  const reason=sunAvailability(s,now),start=performance.now();
  const sun=s.lastFix?solarPosition(now,s.lastFix.lat,s.lastFix.lng):null;computeMs=performance.now()-start;
  const stable=samples.length>=3&&now-samples[0].at>=400&&now-samples.at(-1).at<500&&samples.every(v=>Math.abs(headingDelta(v.heading,s.rawHeading))<5);
  const canObserve=!reason&&s.compassFlat&&stable;
  $('sun-measure').disabled=!canObserve;$('sun-apply').hidden=!observation||applied;$('sun-clear').hidden=!observation;
  $('sun-open').textContent=applied?'Sun correction on':observation?Math.abs(observation.offset)>=SUN.mismatch?'Sun / compass disagree':'Sun check recorded':'Check with a shadow';
  $('sun-open').dataset.state=applied?'applied':observation&&Math.abs(observation.offset)>=SUN.mismatch?'mismatch':'idle';
  $('sun-reading').textContent=observation?`At alignment: compass ${observation.raw.toFixed(1)}°; predicted shadow ${observation.expected.toFixed(1)}° true. Difference ${observation.offset>=0?'+':''}${observation.offset.toFixed(1)}°. ${Math.abs(observation.offset)>=SUN.mismatch?'Disagreement exceeds 15°.':'Within the 15° check threshold; this is not an accuracy guarantee.'} ${applied?'Temporary correction is on.':'Heading is unchanged until you apply it.'}`:'No independent alignment recorded. Prediction alone cannot test the compass.';
  $('sun-conditions').textContent=reason||(!s.compassFlat?'Hold the phone flat, screen facing up.':!stable?'Hold still for a fresh, stable compass reading.':sun?`Predicted Sun: ${sun.azimuth.toFixed(1)}° true, ${sun.elevation.toFixed(1)}° elevation. Only continue if you see a clear shadow.`:'');
  $('sun-message').textContent=message;
  clearTimeout(timer);if(!document.hidden&&s.mode==='gps')timer=setTimeout(refresh,1000);
  if(was!==applied)onChange();
 }
 function onHeading(){
  const s=getSensors(),now=Date.now();
  if(now-lastSample>=100){lastSample=now;samples=samples.filter(v=>now-v.at<1500);if(s.compassFlat)samples.push({at:now,heading:s.rawHeading});else samples=[];if(samples.length>16)samples.shift();if($('sun-dialog').open)refresh();}
 }
 $('sun-open').onclick=()=>{samples=[];message='';$('sun-dialog').showModal();refresh();};
 $('sun-close').onclick=()=>$('sun-dialog').close();
 $('sun-measure').onclick=()=>{
  refresh();if($('sun-measure').disabled)return;
  const result=observeShadow(getSensors(),Date.now());
  if(result.reason){message=result.reason;refresh();return;}
  observation=result.observation;applied=false;message='Alignment recorded. Repeat it if the phone was not pointing along the shadow.';refresh();onChange();
 };
 $('sun-apply').onclick=()=>{if(!observationValid(observation,getSensors(),Date.now())){refresh();return;}applied=true;message='Correction applies to the view and chevron. Clear it whenever alignment seems wrong.';refresh();onChange();};
 $('sun-clear').onclick=()=>{reset('Check cleared. Using the uncorrected compass.');refresh();onChange();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){reset('Check cleared when the app was hidden.');clearTimeout(timer);onChange();}else refresh();});
 refresh();return {refresh,onHeading,heading,snapshot};
}
