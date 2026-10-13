// Progressive enhancement only: everything works without JS.
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-confirm]');
  if (c && !window.confirm(c.dataset.confirm)) e.preventDefault();
  const tog = e.target.closest('[data-toggle]');
  if (tog) document.getElementById(tog.dataset.toggle).classList.toggle('open');
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
});
document.addEventListener('DOMContentLoaded', () => {
  const thread = document.getElementById('thread');
  if (thread) thread.lastElementChild?.scrollIntoView({ block: 'end' });
  const flash = document.querySelector('.flash');
  if (flash) setTimeout(() => flash.classList.add('fade'), 5000);
});
