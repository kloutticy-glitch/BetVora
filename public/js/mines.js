// mines.js — simple mines UI (single reveal per bet due to server API)
(function(){
  const gridEl = document.getElementById('minesGrid');
  if(!gridEl) return;

  function buildGrid(n){
    gridEl.innerHTML='';
    const size = Math.sqrt(n)|0; gridEl.style.gridTemplateColumns = `repeat(${size},64px)`;
    for(let i=0;i<n;i++){
      const t = document.createElement('div'); t.className='mines-tile'; t.dataset.idx=i; t.innerText='';
      t.addEventListener('click', async ()=>{
        if(t.classList.contains('revealed')) return;
        const bet = parseFloat(document.getElementById('betAmount').value)||0;
        const uid = localStorage.getItem('bv_userId'); if(!uid){ alert('Demo login first'); return; }
        const mines = parseInt(document.getElementById('minesCount').value,10)||5;
        // call server with revealCount = index
        const res = await fetch('/api/games/mines',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bet,userId:uid,bombs:mines,revealCount:i})});
        const j = await res.json();
        if(j && j.result){
          if(j.result.hitMine){ t.classList.add('revealed'); t.style.background='linear-gradient(180deg,#ff4b4b,#c70000)'; t.innerText='💣'; window.BVEvents && window.BVEvents.setLast('BOOM! You hit a mine');
          } else { t.classList.add('revealed'); t.innerText='💎'; t.style.background='linear-gradient(180deg,#ffd24d,#ff9f00)'; window.BVEvents && window.BVEvents.setLast('Safe! Win: $'+(j.result.winAmount||0).toFixed(2)); }
          window.BVAuth.refreshBalance();
        }
      });
      gridEl.appendChild(t);
    }
  }

  window.BVMines = {
    setup({bet,userId,gridSize=25,mines=5}){
      buildGrid(gridSize);
      window.BVEvents && window.BVEvents.setLast('Click a tile to reveal (single-reveal per bet)');
      document.getElementById('minesView').classList.remove('hidden');
    }
  };
})();
