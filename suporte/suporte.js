import { setupSidebar, initIcons } from '../logic.js';
setupSidebar();
initIcons();
document.getElementById('sidebar-close')?.addEventListener('click', ()=>{ 
  document.getElementById('sidebar')?.classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
});

// Sidebar publico migrado de suporte-inline-2.js
(function(){
  const openBtn = document.getElementById('sidebar-open');
  const closeBtn = document.getElementById('sidebar-close');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebar = document.getElementById('sidebar');
  function open(){
    overlay.classList.remove('hidden');
    sidebar.classList.remove('-translate-x-full');
    document.body.style.overflow='hidden';
  }
  function close(){
    overlay.classList.add('hidden');
    sidebar.classList.add('-translate-x-full');
    document.body.style.overflow='';
  }
  if(openBtn) openBtn.addEventListener('click', open);
  if(closeBtn) closeBtn.addEventListener('click', close);
  if(overlay) overlay.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
})();

// Icones migrados de suporte-inline-3.js
lucide.createIcons();
