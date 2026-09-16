// Adds new behavior to the captured pages without changing their archived HTML.
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.captcha-li').forEach(node => node.remove());
  document.querySelectorAll('form[action]').forEach(form => {
    const action=new URL(form.action).pathname;
    if(action==='/Search/Index') {
      form.addEventListener('submit',event=>{
        event.preventDefault(); event.stopImmediatePropagation();
        const term=new FormData(form).get('search')||'';
        location.href='/search/?q='+encodeURIComponent(term);
      },true);
      return;
    }
    if(!['/Contact/SendComment','/Career/Send','/WorkWithUs/Send','/Products/SendComment'].includes(action)) return;
    const honeypot=document.createElement('input');
    honeypot.name='website'; honeypot.autocomplete='off'; honeypot.tabIndex=-1;
    honeypot.style.cssText='position:absolute;left:-9999px';
    form.append(honeypot);
    const status=document.createElement('p'); status.setAttribute('role','status'); status.style.margin='1rem 0';
    form.append(status);
    form.addEventListener('submit',async event=>{
      event.preventDefault(); event.stopImmediatePropagation();
      const data=new FormData(form);
      data.set('PagePath',location.pathname);
      status.textContent='در حال ارسال…';
      try {
        const response=await fetch(action,{method:'POST',body:data});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error||'ارسال ناموفق بود');
        status.textContent=result.message||'پیام شما ثبت شد.';
        form.reset();
      } catch(error) { status.textContent=error.message; }
    },true);
  });
  // The old dependent city selector calls an unavailable database. Accept a free-text city.
  if(/^\/(?:work-with-us|workwithus)(?:\/|$)/i.test(location.pathname)) {
    const city=document.querySelector('#CityId');
    if(city) {
      const input=document.createElement('input');
      input.name='CityName'; input.placeholder='شهر'; input.className='form-control';
      city.insertAdjacentElement('afterend',input);
      city.style.display='none';
      window.getCity=()=>{};
      window.getState=()=>{};
    }
  }
});
