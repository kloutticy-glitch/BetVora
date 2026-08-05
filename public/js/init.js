// init.js — authentication + helpers
window.BVAuth = (function(){
  const API = '';
  async function demoLogin(){
    // register a demo account or login if exists
    const name = 'demo_'+Math.floor(Math.random()*10000);
    const email = name+'@demo.local';
    const password = 'demoPass';
    try{
      const r = await fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,email,password})});
      const json = await r.json();
      if(json && json.userId){
        localStorage.setItem('bv_userId',json.userId);
        window.BVAuth.balance = json.balance;
        window.BVEvents && window.BVEvents.updateBalance(json.balance);
        window.BVEvents && window.BVEvents.setLast('Demo account created');
        return json;
      }
    }catch(e){ console.warn(e); }
    // fallback: try login
    try{
      const r2 = await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
      const j2 = await r2.json();
      if(j2 && j2.id){ localStorage.setItem('bv_userId',j2.id); window.BVAuth.balance=j2.balance; window.BVEvents && window.BVEvents.updateBalance(j2.balance); return j2; }
    }catch(e){ console.warn(e); }
  }
  async function refreshBalance(){
    const uid = localStorage.getItem('bv_userId'); if(!uid) return;
    const r = await fetch('/api/user/'+uid+'/balance'); if(!r.ok) return;
    const j = await r.json(); window.BVAuth.balance = j.balance; window.BVEvents && window.BVEvents.updateBalance(j.balance);
  }
  return { demoLogin, refreshBalance };
})();

// small periodic refresh
setInterval(()=>{ window.BVAuth.refreshBalance(); },5000);
