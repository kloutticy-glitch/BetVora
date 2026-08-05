// plinko.js — canvas plinko + server integration
(function(){
  const canvas = document.getElementById('plinkoCanvas');
  if(!canvas) return;
  canvas.width = 920; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const pegs = [];
  let ball = null;
  const multipliers = [16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16];

  function buildPegs(rows){
    pegs.length = 0;
    const startY = 80; const spacingX = 44; const spacingY = 44;
    for(let r=0;r<rows;r++){
      const count = r+1;
      for(let i=0;i<count;i++){
        const offsetX = (canvas.width - count*spacingX)/2 + i*spacingX + (r%2?spacingX/2:0);
        const y = startY + r*spacingY;
        pegs.push({x:offsetX,y:y,r:6});
      }
    }
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    // background
    ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // pegs
    pegs.forEach(p=>{ ctx.beginPath(); ctx.fillStyle='#fff'; ctx.globalAlpha=0.95; ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; });
    // ball
    if(ball){ ctx.beginPath(); ctx.fillStyle='#ffcc00'; ctx.arc(ball.x,ball.y,10,0,Math.PI*2); ctx.fill(); }
  }

  function simulate(rows,cb){
    buildPegs(rows);
    ball = {x:canvas.width/2,y:40,vx:0,vy:0};
    let t=0;
    function step(){
      t++; ball.vy += 0.45; ball.x += ball.vx; ball.y += ball.vy;
      // collision with pegs
      pegs.forEach(p=>{
        const dx = ball.x - p.x; const dy = ball.y - p.y; const dist = Math.hypot(dx,dy);
        if(dist < p.r + 10){ ball.vx += dx/dist*1.6; ball.vy *= 0.9; }
      });
      // confine
      if(ball.x<20) ball.x=20; if(ball.x>canvas.width-20) ball.x=canvas.width-20;
      draw();
      if(ball.y > canvas.height - 120){
        // find slot
        const slotW = 44; const index = Math.floor((ball.x - (canvas.width - multipliers.length*slotW)/2)/slotW);
        cb(Math.max(0,Math.min(multipliers.length-1,index))); ball=null; return;
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.BVPlinko = {
    play: async function({bet,userId,rows=16}){
      window.BVEvents && window.BVEvents.setLast('Plinko dropping...');
      simulate(rows,function(slotIndex){
        // call server with bet
        (async()=>{
          try{
            const res = await fetch('/api/games/plinko',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bet,userId,rows})});
            const j = await res.json();
            window.BVAuth.refreshBalance();
            if(j && j.result){
              const mult = j.result.multiplier; window.BVEvents && window.BVEvents.setLast('Result: x'+mult+' | Win: $'+(j.result.winAmount||0).toFixed(2));
            }
          }catch(e){ console.error(e); window.BVEvents && window.BVEvents.setLast('Server error'); }
        })();
      });
    }
  };
})();
