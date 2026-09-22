import {chromium} from 'playwright';
// Existing scene tests disable the optional persisted road downloader. Its default
// startup, persistence and network behavior are covered separately by test:road-cache.
export async function launchTestBrowser(){const browser=await chromium.launch({headless:true}),create=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await create(options);await context.addInitScript(()=>localStorage.setItem('navigator-roads-enabled','false'));return context;};return browser;}
