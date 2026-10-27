import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto(process.env.BASE_URL||'http://127.0.0.1:3042');
 const result=await page.evaluate(async()=>{
  const {state}=await import('/js/core/state.ts');
  const {createPluginApi}=await import('/js/plugins/plugin-api.js');
  const d=await import('/js/pdf/render-diagnostics.js');
  state.documents=[{id:'diagnostic-fixture',filePath:'/fixture.pdf',fileName:'fixture.pdf',currentPage:1,numPages:1,annotations:[],pageRotations:{},pdfDoc:{numPages:1}}];
  state.activeDocumentIndex=0;
  await d.observeNativeRender('render_pdf_page',{path:'/fixture.pdf',pageIndex:0},async()=>{throw new Error('PDF_OUTPUT_LIMIT');}).catch(()=>{});
  const api=createPluginApi('diagnostic-contract');
  const plugin=api.getDocumentInfo().renderDiagnostics;
  const listeners={};let response;
  window.__TAURI__={event:{listen:async(name,fn)=>{listeners[name]=fn;return ()=>{};}},core:{invoke:async(cmd,args)=>{if(cmd==='app_response')response=args;return null;}}};
  const {initMcpBridge}=await import('/js/mcp-bridge.js');await initMcpBridge();
  await listeners['mcp:get-viewport-state']({payload:{request_id:123,params:{}}});
  return {plugin,response};
 });
 assert.equal(result.plugin.pages[0].findings[0].code,'PDF_OUTPUT_LIMIT');
 assert.ok(JSON.stringify(result.response).includes('PDF_OUTPUT_LIMIT'));
 await page.getByRole('button',{name:/Render findings: 1|Rendermeldingen: 1/}).waitFor();
 console.log('PASS: structured render failure visible in status bar, Plugin API and MCP response');
} finally {await browser.close();}
