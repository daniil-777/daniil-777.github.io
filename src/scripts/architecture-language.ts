import { initializeLanguage, setLocale } from '../i18n/client';
import { isLocale } from '../i18n/core';

initializeLanguage();
const session = new URLSearchParams(location.search).get('session');
window.addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== location.origin || !session) return;
  const data = event.data;
  if (data?.channel === 'portfolio-architecture' && data.session === session && data.type === 'language' && isLocale(data.locale)) void setLocale(data.locale, false);
});
