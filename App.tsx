
import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Clock, ChevronLeft, Save, Sparkles, 
  Settings, RefreshCw, CheckCircle2, Calendar as CalendarIcon, Search, X, ChevronRight, AlertCircle, Edit2, Loader2, Copy, ShieldCheck, Zap
} from 'lucide-react';
import { ClassGroup, Student, ActivityRecord } from './types';
import { polishRecord } from './services/geminiService';

const GAS_CODE = `
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const data = sheets.map(sheet => {
    const name = sheet.getName();
    if (name.includes("_기록")) return null;
    const values = sheet.getDataRange().getValues();
    const students = values.slice(1).map(row => ({
      id: name + "_" + row[0],
      number: row[0],
      name: row[1]
    })).filter(s => s.name);
    return { id: name, name: name, students: students };
  }).filter(d => d !== null);
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = data.className + "_기록";
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["날짜", "번호", "이름", "내용"]);
    sheet.getRange("A1:D1").setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  
  const now = new Date();
  const dateStr = Utilities.formatDate(now, "GMT+9", "yyyy-MM-dd HH:mm");
  sheet.appendRow([dateStr, data.studentNumber, data.studentName, data.content]);
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}
`.trim();

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'main' | 'recent'>('main');
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [editingRecord, setEditingRecord] = useState<ActivityRecord | null>(null);
  
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const [sheetUrl, setSheetUrl] = useState<string>(localStorage.getItem('edulog_sheet_url') || '');
  
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string, type: 'success' | 'info' | 'error' } | null>(null);

  const [content, setContent] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStatus, setPolishStatus] = useState('AI 문체 변환');
  const [classSearchQuery, setClassSearchQuery] = useState('');

  useEffect(() => {
    if (sheetUrl) fetchClasses();
    const saved = localStorage.getItem('edulog_records');
    if (saved) setRecords(JSON.parse(saved));
  }, []);

  const fetchClasses = async (urlOverride?: string) => {
    const targetUrl = (urlOverride || sheetUrl).trim();
    if (!targetUrl) return;
    setIsLoading(true);
    try {
      const response = await fetch(targetUrl);
      const data = await response.json();
      if (Array.isArray(data)) {
        setClasses(data);
        setIsConnected(true);
        localStorage.setItem('edulog_sheet_url', targetUrl);
      }
    } catch (error) {
      setIsConnected(false);
      showToast('명단 불러오기 실패. URL을 확인해 주세요.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('edulog_sheet_url', sheetUrl);
    fetchClasses();
    setIsSettingsOpen(false);
    showToast('설정이 저장되었습니다.');
  };

  const activeClass = classes.find(c => c.id === selectedClassId);
  const filteredClasses = useMemo(() => {
    return classes.filter(c => c.name.toLowerCase().includes(classSearchQuery.toLowerCase()));
  }, [classes, classSearchQuery]);

  const groupedRecords = useMemo(() => {
    const groups: { [key: string]: ActivityRecord[] } = {};
    records.forEach(record => {
      const date = new Date(record.timestamp).toLocaleDateString('ko-KR');
      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [records]);

  const handleOpenLog = (student: Student) => {
    setSelectedStudent(student);
    setEditingRecord(null);
    setContent('');
    setPolishStatus('AI 문체 변환');
    setIsLogModalOpen(true);
  };

  const handleSaveRecord = async () => {
    if (!selectedStudent || !content.trim() || isPolishing) return;
    const currentContent = content.trim();
    const currentStudent = { ...selectedStudent };
    const currentClassName = activeClass?.name || editingRecord?.className || '';

    if (editingRecord) {
      const updatedRecords = records.map(r => r.id === editingRecord.id ? { ...r, content: currentContent } : r);
      setRecords(updatedRecords);
      localStorage.setItem('edulog_records', JSON.stringify(updatedRecords));
      showToast('기록이 수정되었습니다.');
    } else {
      const newRecord: ActivityRecord = {
        id: crypto.randomUUID(),
        studentId: currentStudent.id,
        studentName: currentStudent.name,
        studentNumber: currentStudent.number,
        classId: selectedClassId || '',
        className: currentClassName,
        type: '활동',
        content: currentContent,
        timestamp: Date.now()
      };
      const updatedRecords = [newRecord, ...records];
      setRecords(updatedRecords);
      localStorage.setItem('edulog_records', JSON.stringify(updatedRecords));
      showToast('임시 저장되었습니다.');
    }
    setIsLogModalOpen(false);

    if (sheetUrl && !editingRecord) {
      setIsSyncing(true);
      try {
        await fetch(sheetUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify({
            className: currentClassName,
            studentNumber: currentStudent.number,
            studentName: currentStudent.name,
            content: currentContent
          })
        });
        showToast('구글 시트 전송 완료');
      } catch (e) {
        showToast('시트 전송 실패', 'error');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleAIPolish = async () => {
    if (!content.trim() || isPolishing) return;
    setIsPolishing(true);
    setPolishStatus('AI가 분석 중...');
    try {
      const polished = await polishRecord(content, (status) => setPolishStatus(status));
      setContent(polished);
      showToast('AI 변환 완료');
    } catch (e) {
      showToast('변환 중 오류 발생', 'error');
    } finally {
      setIsPolishing(false);
      setPolishStatus('AI 문체 변환');
    }
  };

  return (
    <div className="min-h-screen max-w-4xl mx-auto bg-slate-50 flex flex-col shadow-2xl border-x border-slate-200 overflow-hidden">
      {toastMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4">
          <div className={`px-6 py-3 rounded-full shadow-xl border flex items-center gap-3 text-white font-bold text-sm
            ${toastMessage.type === 'success' ? 'bg-emerald-600 border-emerald-400' : 
              toastMessage.type === 'error' ? 'bg-red-600 border-red-400' : 'bg-slate-800 border-slate-600'}`}>
            {toastMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            {toastMessage.text}
          </div>
        </div>
      )}

      <header className="bg-indigo-700 text-white p-5 sticky top-0 z-50 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          {selectedClassId || viewMode === 'recent' ? (
            <button onClick={() => { setSelectedClassId(null); setViewMode('main'); }} className="p-2 hover:bg-white/10 rounded-full transition-all">
              <ChevronLeft size={24} strokeWidth={3} />
            </button>
          ) : (
            <div className="p-2 bg-white/10 rounded-xl"><BookOpen size={24} /></div>
          )}
          <div>
            <h1 className="text-xl font-black tracking-tight">
              {selectedClassId ? activeClass?.name : viewMode === 'recent' ? '기록 보관소' : '에듀로그 (EduLog)'}
            </h1>
            <div className="flex items-center gap-1.5 opacity-70">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-400'}`}></div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{isConnected ? '연결됨' : '연결 안 됨'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode(viewMode === 'main' ? 'recent' : 'main')} className={`p-2.5 rounded-xl transition-all ${viewMode === 'recent' ? 'bg-white text-indigo-700 shadow-md' : 'hover:bg-white/10'}`}>
            <Clock size={22} />
          </button>
          <button onClick={() => fetchClasses()} className="p-2.5 hover:bg-white/10 rounded-xl transition-all active:scale-95">
            <RefreshCw size={22} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all">
            <Settings size={22} />
          </button>
        </div>
      </header>

      <main className="flex-1 p-5 overflow-y-auto pb-24 no-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400 gap-4">
            <Loader2 size={40} className="animate-spin text-indigo-600" />
            <p className="font-black">명단을 불러오는 중...</p>
          </div>
        ) : !selectedClassId && viewMode === 'main' ? (
          <div className="space-y-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="text" 
                placeholder="학급 검색 (예: 1학년 1반)..." 
                value={classSearchQuery}
                onChange={(e) => setClassSearchQuery(e.target.value)}
                className="w-full bg-white border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-indigo-500 font-bold shadow-sm transition-all"
              />
            </div>
            
            {classes.length === 0 ? (
              <div className="bg-white rounded-[2.5rem] p-12 text-center border-2 border-dashed border-slate-200 space-y-6 shadow-sm">
                <ShieldCheck size={64} className="mx-auto text-slate-300" />
                <h3 className="text-xl font-black text-slate-800">연결된 구글 시트가 없습니다</h3>
                <p className="text-slate-400 font-medium leading-relaxed">상단 설정(⚙️) 메뉴에서 시트 URL을 연동하고<br/>명단을 불러와 주세요.</p>
                <button onClick={() => setIsSettingsOpen(true)} className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">설정 바로가기</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {filteredClasses.map(c => (
                  <button key={c.id} onClick={() => setSelectedClassId(c.id)} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:border-indigo-500 hover:shadow-md transition-all text-left flex items-center justify-between group active:scale-[0.98]">
                    <div>
                      <h3 className="text-xl font-black text-slate-800 group-hover:text-indigo-600">{c.name}</h3>
                      <p className="text-xs text-slate-400 font-bold mt-1 uppercase tracking-wider">{c.students.length} Students</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-indigo-50 transition-colors">
                      <ChevronRight className="text-slate-300 group-hover:text-indigo-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : selectedClassId && viewMode === 'main' ? (
          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 animate-in fade-in zoom-in-95 duration-300">
            {activeClass?.students.map(student => (
              <button key={student.id} onClick={() => handleOpenLog(student)} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:border-indigo-500 hover:bg-indigo-50 transition-all flex flex-col items-center gap-3 active:scale-90 group">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-500 font-black text-lg border border-slate-100 group-hover:bg-white group-hover:border-indigo-200 group-hover:text-indigo-600 transition-colors">{student.number}</div>
                <span className="font-black text-slate-700 text-sm group-hover:text-indigo-700">{student.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-10 animate-in fade-in duration-500">
            {groupedRecords.length === 0 ? (
              <div className="py-32 text-center text-slate-300 space-y-4">
                <CalendarIcon size={64} className="mx-auto opacity-10" />
                <p className="font-black text-sm">저장된 활동 기록이 없습니다.</p>
              </div>
            ) : (
              groupedRecords.map(([date, dateRecords]) => (
                <div key={date} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="bg-indigo-50 text-indigo-600 px-4 py-1.5 rounded-full text-[10px] font-black border border-indigo-100 shadow-sm">{date}</span>
                    <div className="flex-1 h-px bg-slate-200"></div>
                  </div>
                  {dateRecords.map(record => (
                    <div key={record.id} onClick={() => { setEditingRecord(record); setContent(record.content); setSelectedStudent({id: record.studentId, name: record.studentName, number: record.studentNumber}); setIsLogModalOpen(true); }} 
                         className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all cursor-pointer group active:scale-[0.99]">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center font-black text-indigo-600 text-xs border border-indigo-100">{record.studentNumber}</div>
                          <div>
                            <span className="font-black text-slate-800 text-lg group-hover:text-indigo-600 transition-colors">{record.studentName}</span>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-tighter">{record.className}</p>
                          </div>
                        </div>
                        <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-indigo-50 transition-colors">
                          <Edit2 size={14} className="text-slate-300 group-hover:text-indigo-500" />
                        </div>
                      </div>
                      <p className="text-slate-600 font-semibold text-sm leading-relaxed bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100/50 group-hover:bg-indigo-50/30 transition-colors">{record.content}</p>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[100] flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl p-8 space-y-8 max-h-[90vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                <Settings className="text-indigo-600" /> 시스템 연동 가이드
              </h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 bg-slate-50 rounded-full text-slate-400 hover:bg-slate-100 transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-8">
              <div className="p-5 bg-indigo-50 rounded-3xl border border-indigo-100 space-y-3 shadow-inner">
                <div className="flex items-center gap-2 text-indigo-700 font-black text-sm">
                  <Zap size={16} className="fill-indigo-700" />
                  필독: AI 기능 사용을 위한 설정
                </div>
                <p className="text-[11px] text-indigo-600 leading-relaxed font-bold">
                  AI 문체 변환을 사용하려면 Vercel 환경 변수에 <code className="bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-200">API_KEY</code>를 등록해야 합니다.<br/>(더 이상 화면에서 수동으로 입력하지 않아 보안이 더욱 안전합니다.)
                </p>
              </div>

              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-black text-slate-600 border-l-4 border-indigo-600 pl-3">구글 시트 연동 (데이터 저장)</h3>
                  <button onClick={() => { navigator.clipboard.writeText(GAS_CODE); showToast('코드가 복사되었습니다.'); }} className="text-[10px] font-bold text-indigo-600 flex items-center gap-1.5 bg-indigo-50 px-4 py-2 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-100">
                    <Copy size={12} /> 스크립트 복사
                  </button>
                </div>
                <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 text-[12px] font-bold text-slate-600 leading-relaxed space-y-3">
                  <p>1. 구글 시트 상단 [확장 프로그램] &gt; [Apps Script]를 엽니다.</p>
                  <p>2. [스크립트 복사] 버튼으로 복사한 내용을 붙여넣고 저장하세요.</p>
                  <p>3. [배포] &gt; [새 배포] &gt; 유형: [웹 앱] &gt; 액세스: [모든 사람] 설정 후 배포합니다.</p>
                  <p>4. 생성된 [웹 앱 URL]을 아래에 입력해 주세요.</p>
                </div>
                <input 
                  type="text" 
                  value={sheetUrl} 
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full p-5 bg-white border-2 border-slate-100 rounded-2xl outline-none font-bold text-[11px] focus:border-indigo-500 shadow-sm transition-all"
                />
              </section>
            </div>
            <button onClick={handleSaveSettings} className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">설정 저장 및 명단 갱신</button>
          </div>
        </div>
      )}

      {isLogModalOpen && selectedStudent && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center p-0 sm:p-5">
          <div className="bg-white w-full max-w-lg rounded-t-[3.5rem] sm:rounded-[4.5rem] shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 duration-500">
            <div className="p-10 pb-4 flex justify-between items-center border-b border-slate-50">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-3xl shadow-xl border-2 border-white">{selectedStudent.number}</div>
                <div>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">{selectedStudent.name}</h2>
                  <p className="text-[11px] text-indigo-500 font-black uppercase tracking-widest">{editingRecord ? editingRecord.className : activeClass?.name}</p>
                </div>
              </div>
              <button onClick={() => setIsLogModalOpen(false)} disabled={isPolishing} className="p-3 text-slate-300 hover:text-slate-600 transition-colors"><X size={28} /></button>
            </div>

            <div className="p-10 pt-8 space-y-8">
              <div className="relative group">
                <textarea 
                  autoFocus 
                  disabled={isPolishing}
                  value={content} 
                  onChange={(e) => setContent(e.target.value)} 
                  placeholder="학생의 행동을 자유롭게 메모하세요. AI가 생기부 문체로 변환해 드립니다."
                  className="w-full h-80 p-10 bg-slate-50 border-2 border-slate-100 rounded-[3.5rem] outline-none text-slate-800 font-bold text-lg leading-relaxed focus:border-indigo-500 focus:bg-white transition-all disabled:opacity-50 shadow-inner"
                />
                <div className="absolute bottom-8 right-8 flex gap-3">
                  <button onClick={handleAIPolish} disabled={isPolishing || !content.trim()} 
                          className={`flex items-center gap-3 px-8 py-5 rounded-[2rem] text-[14px] font-black shadow-2xl transition-all active:scale-95 disabled:bg-slate-200 disabled:text-slate-400
                          ${isPolishing ? 'bg-amber-500 text-white animate-pulse' : 'bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-50'}`}>
                    {isPolishing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} className="text-indigo-500" />}
                    {polishStatus}
                  </button>
                </div>
              </div>

              <div className="flex gap-4 pb-4">
                <button onClick={() => setIsLogModalOpen(false)} className="flex-1 py-4 text-slate-400 font-black hover:text-slate-600 transition-colors">닫기</button>
                <button onClick={handleSaveRecord} disabled={!content.trim() || isPolishing} className="flex-2 grow-[2] bg-indigo-600 text-white py-5 rounded-[2rem] font-black flex items-center justify-center gap-3 shadow-2xl hover:bg-indigo-700 active:scale-95 disabled:bg-slate-100 transition-all">
                  <Save size={22} /> {editingRecord ? '수정 내용 저장' : '시트에 저장하기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
