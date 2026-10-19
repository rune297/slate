'use strict';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const activeAnimations=new Map();
function pulse(element,frames,duration){activeAnimations.get(element)?.cancel();if(reduced.matches)return;const animation=element.animate(frames,{duration,easing:'cubic-bezier(.16,1,.3,1)'});activeAnimations.set(element,animation);animation.finished.then(()=>{if(activeAnimations.get(element)===animation)activeAnimations.delete(element);}).catch(()=>{});}
window.copyFeedback.onState(state=>{
  const toast=document.getElementById('copy-toast');
  if(!state.visible){toast.classList.remove('visible');return;}
  document.documentElement.dataset.theme=state.theme==='dark'?'dark':'light';
  document.getElementById('copy-title').textContent=state.title;
  document.getElementById('copy-description').textContent=state.description;
  const count=document.getElementById('copy-count');count.hidden=state.count<2;count.textContent='×'+state.count;
  toast.classList.add('visible');
  pulse(document.querySelector('.copy-check'),[{transform:'scale(.78) rotate(-12deg)'},{transform:'scale(1.12) rotate(5deg)',offset:.42},{transform:'scale(.98) rotate(-2deg)',offset:.72},{transform:'scale(1) rotate(0)'}],420);
  pulse(document.querySelector('.copy-check path'),[{strokeDasharray:'28',strokeDashoffset:'28'},{strokeDasharray:'28',strokeDashoffset:'0'}],330);
  if(!count.hidden)pulse(count,[{transform:'translateY(5px) scale(.85)'},{transform:'translateY(-3px) rotate(-7deg) scale(1.16)',offset:.35},{transform:'translateY(1px) rotate(5deg) scale(1.03)',offset:.62},{transform:'translateY(0) rotate(-2deg)',offset:.82},{transform:'none'}],440);
});
