import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPathProblem,inputPathProblem,SAFE_EXTENSIONS} from './export-path-policy.js';
test('executable and script extensions are refused for exported components',()=>{
 for(const ext of ['exe','bat','cmd','com','scr','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','msi','msp','lnk','hta','reg','dll','cpl','jar','pif','url','scf','appref-ms','msc','gadget','application','inf','sys','svg','html','htm','xhtml','mht','chm','docm','xlsm','pptm','iso','vhd','vhdx','sh','command','app','desktop','py'])
  assert.equal(exportPathProblem('C:\\Users\\me\\Desktop\\file.'+ext),'BLOCKED_EXTENSION',ext);
 assert.equal(exportPathProblem('C:\\Users\\me\\Desktop\\FILE.EXE'),'BLOCKED_EXTENSION');
 assert.equal(exportPathProblem('/home/me/no-extension'),'BLOCKED_EXTENSION');
});
test('Windows name tricks cannot smuggle an executable past the extension check',()=>{
 for(const path of ['C:\\x\\evil.exe.','C:\\x\\evil.exe ','C:\\x\\evil.exe. . ','C:\\x\\plan.pdf:evil.exe','C:\\x\\plan.pdf::$DATA','C:\\x\\a\u0000.pdf','\\\\?\\C:\\x\\a.pdf','\\\\.\\C:\\x\\a.pdf','\\\\server\\share\\a.pdf','//server/share/a.pdf','relative\\a.pdf','a.pdf','C:a.pdf'])
  assert.notEqual(exportPathProblem(path),null,path);
});
test('autostart folders are refused, also through dot segments and other separators',()=>{
 for(const path of [
  'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.pdf',
  'C:/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/StartUp/a.txt',
  'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.pdf',
  'C:\\Users\\me\\Documents\\..\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\.\\Startup\\a.pdf',
  'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\STARTM~1\\Programs\\Startup\\a.pdf',
  '/home/me/.config/autostart/a.txt','/etc/xdg/autostart/a.txt','/Users/me/Library/LaunchAgents/a.xml','/Library/LaunchDaemons/a.xml',
 ])assert.equal(exportPathProblem(path),'AUTOSTART_LOCATION',path);
});
test('ordinary documents and data files in normal folders are allowed',()=>{
 for(const path of ['C:\\Users\\me\\Documents\\plan.pdf','C:\\Users\\me\\Documents\\Start Menu notes\\budget.xlsx','D:\\Projects\\model.ifc','/home/me/Documents/report.docx','/Users/me/Desktop/photo.JPG'])
  assert.equal(exportPathProblem(path),null,path);
 for(const ext of ['pdf','txt','csv','json','xml','docx','xlsx','png','jpg','dwg','dxf','ifc'])assert.ok(SAFE_EXTENSIONS.has(ext),ext);
});
test('files added to a collection over MCP need an absolute local path of a document or data type',()=>{
 assert.equal(inputPathProblem('C:\\Users\\me\\Documents\\spec.pdf'),null);
 assert.equal(inputPathProblem('/home/me/spec.txt'),null);
 for(const path of ['spec.pdf','..\\spec.pdf','\\\\server\\share\\spec.pdf','C:\\Users\\me\\.ssh\\id_rsa','C:\\Users\\me\\AppData\\Local\\app\\Login Data','/home/me/.bash_history','C:\\x\\a.pdf:secret',''])
  assert.notEqual(inputPathProblem(path),null,path);
});
