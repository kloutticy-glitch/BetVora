// dice.js — slider + roll animation
(function(){
  const sliderEl = document.getElementById('diceSlider');
  const valueEl = document.getElementById('diceRollValue');
  if(!sliderEl) return;
  sliderEl.style.width='720px'; sliderEl.style.height='18px'; sliderEl.style.borderRadius='12px';

  window.BVDice = {
    play: async function({bet,userId,target=50}){
      window.BVEvents && window.BVEvents.setLast('Rolling...');
      // animate random roll
      let cur=0; const dur=1200; const start=Date.now(); function anim(){ const t=(Date.now()-start)/dur; cur = Math.min(100, Math.floor(100*Math.random())); valueEl.innerText = cur.toFixed(2); if(Date.now()-start<dur) requestAnimationFrame(anim); }
      anim();
      try{
        const res = await fetch('/api/games/dice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bet,userId})});
        const j = await res.json();
        if(j && j.result){
          valueEl.innerText = (j.result.roll||0).toFixed(2);
          window.BVEvents && window.BVEvents.setLast('Roll: '+(j.result.roll||0).toFixed(2)+' | Win: $'+(j.result.winAmount||0).toFixed(2));
          window.BVAuth.refreshBalance();
        }
      }catch(e){ console.error(e); window.BVEvents && window.BVEvents.setLast('Error'); }
    }
  };
})();
