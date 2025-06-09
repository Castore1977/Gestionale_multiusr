import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, query, where, writeBatch, getDocs } from 'firebase/firestore';
import { ArrowRight, Plus, Users, Trash2, Edit, LayoutDashboard, BarChart3, X, AlertTriangle, FileDown, FileUp, CheckCircle,ClipboardList } from 'lucide-react';

// --- CONFIGURAZIONE FIREBASE ---
const firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}');
const appId = firebaseConfig.projectId || 'default-gantt-app-master';

// --- FUNZIONI UTILI ---
const calculateDaysDifference = (d1, d2) => {
    if (!d1 || !d2) return 0;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    date1.setHours(0, 0, 0, 0);
    date2.setHours(0, 0, 0, 0);
    const diffTime = date2.getTime() - date1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

const formatCurrency = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value || 0);

const getContrastingTextColor = (hexcolor) => {
    if (!hexcolor) return 'text-white';
    if (hexcolor.startsWith('#')) {
        hexcolor = hexcolor.slice(1);
    }
    if (hexcolor.length === 3) {
        hexcolor = hexcolor.split('').map(char => char + char).join('');
    }
    if (hexcolor.length !== 6) {
        return 'text-white';
    }
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'text-black' : 'text-white';
};


// --- GESTIONE FESTIVITA' ---
const italianHolidays2025 = {
    '2025-01-01': 'Capodanno', '2025-01-06': 'Epifania', '2025-04-20': 'Pasqua', '2025-04-21': 'Lunedì dell\'Angelo',
    '2025-04-25': 'Festa della Liberazione', '2025-05-01': 'Festa del Lavoro', '2025-06-02': 'Festa della Repubblica',
    '2025-08-15': 'Ferragosto', '2025-11-01': 'Tutti i Santi', '2025-12-08': 'Immacolata Concezione',
    '2025-12-25': 'Natale', '2025-12-26': 'Santo Stefano',
};

const checkDateWarning = (date) => {
    if (!date) return null;
    const d = new Date(date);
    d.setHours(12,0,0,0);
    const day = d.getDay();
    if (day === 0) return 'Attenzione: la data di fine cade di Domenica.';
    if (day === 6) return 'Attenzione: la data di fine cade di Sabato.';
    const dateString = d.toISOString().split('T')[0];
    if (italianHolidays2025[dateString]) return `Attenzione: la data di fine coincide con una festività (${italianHolidays2025[dateString]}).`;
    return null;
};

// --- COMPONENTI UI ---
const Loader = ({ message }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex flex-col justify-center items-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white"></div>
        <p className="text-white mt-4 text-lg">{message}</p>
    </div>
);

const Notification = ({ message, onClose, type = 'info' }) => {
    if (!message) return null;
    const colors = { info: 'bg-blue-500', success: 'bg-green-500', error: 'bg-red-500' };
    return ( <div className={`fixed top-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg z-50 animate-fade-in-down ${colors[type]}`}> <span>{message}</span> <button onClick={onClose} className="ml-4 font-bold">X</button> </div> );
};

const Modal = ({ children, isOpen, onClose, title }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white z-10"> <h3 className="text-xl font-semibold text-gray-800">{title}</h3> <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button> </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const DatePicker = ({ value, onChange, ...props }) => {
  const formatDate = (date) => {
    if (!date) return '';
    try { const d = new Date(date); const year = d.getFullYear(); const month = (d.getMonth() + 1).toString().padStart(2, '0'); const day = d.getDate().toString().padStart(2, '0'); return `${year}-${month}-${day}`; } catch(e) { return ''; }
  };
  return ( <input type="date" value={formatDate(value)} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm" {...props} /> );
};

// --- COMPONENTI SPECIFICI ---

const ResourceManagement = ({ resources, db }) => {
  const [editingResource, setEditingResource] = useState(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [hourlyCost, setHourlyCost] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const uniqueCompanies = useMemo(() => [...new Set(resources.map(r => r.company).filter(Boolean))], [resources]);
  const resetForm = () => { setEditingResource(null); setName(''); setCompany(''); setNotes(''); setHourlyCost(''); setEmail(''); setPhone(''); };
  const handleEdit = (resource) => { setEditingResource(resource); setName(resource.name); setCompany(resource.company || ''); setNotes(resource.notes || ''); setHourlyCost(resource.hourlyCost || ''); setEmail(resource.email || ''); setPhone(resource.phone || ''); };
  const handleSubmit = async () => { if (name.trim() === '') return; const resourceData = { name: name.trim(), company: company.trim(), notes: notes.trim(), hourlyCost: Number(hourlyCost) || 0, email: email.trim(), phone: phone.trim() }; try { if (editingResource) { await updateDoc(doc(db, `/artifacts/${appId}/public/data/resources`, editingResource.id), resourceData); } else { await addDoc(collection(db, `/artifacts/${appId}/public/data/resources`), resourceData); } resetForm(); } catch (error) { console.error("Errore salvataggio risorsa:", error); } };
  const confirmDelete = (id) => { setResourceToDelete(id); setIsConfirmOpen(true); };
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState(null);
  const deleteResource = async () => { if (!resourceToDelete) return; try { await deleteDoc(doc(db, `/artifacts/${appId}/public/data/resources`, resourceToDelete)); } catch (error) { console.error("Errore eliminazione risorsa:", error); } finally { setIsConfirmOpen(false); setResourceToDelete(null); } };

  return ( <> <Modal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} title="Conferma Eliminazione"> <div> <p>Sei sicuro di voler eliminare questa risorsa?</p> <div className="flex justify-end mt-4"> <button onClick={() => setIsConfirmOpen(false)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded-md mr-2">Annulla</button> <button onClick={deleteResource} className="bg-red-600 text-white px-4 py-2 rounded-md">Elimina</button> </div> </div> </Modal> <div> <h4 className="text-lg font-medium text-gray-700 mb-3">{editingResource ? 'Modifica Risorsa' : 'Aggiungi Risorsa'}</h4> <div className="space-y-4 p-4 border rounded-md bg-gray-50 mb-6"> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-sm font-medium text-gray-700">Nome Risorsa</label> <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" required/> </div> <div> <label className="block text-sm font-medium text-gray-700">Società</label> <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" list="companies-datalist" /> <datalist id="companies-datalist">{uniqueCompanies.map(c => <option key={c} value={c} />)}</datalist> </div> <div> <label className="block text-sm font-medium text-gray-700">Email</label> <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mario.rossi@example.com" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> <div> <label className="block text-sm font-medium text-gray-700">Telefono</label> <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 1234567" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> <div> <label className="block text-sm font-medium text-gray-700">Costo Orario (€)</label> <input type="number" value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} placeholder="50" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> </div> <div> <label className="block text-sm font-medium text-gray-700">Note</label> <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Specializzazione, contatto, etc." rows="2" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm"></textarea> </div> <div className="flex justify-end items-center gap-4"> {editingResource && (<button onClick={resetForm} className="text-sm text-gray-600 hover:underline">Annulla modifica</button>)} <button onClick={handleSubmit} className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center gap-2"> <Plus size={16} /> {editingResource ? 'Salva Modifiche' : 'Aggiungi Risorsa'} </button> </div> </div> <h4 className="text-lg font-medium text-gray-700 mb-3">Elenco Risorse</h4> <div className="space-y-2 max-h-60 overflow-y-auto"> {resources.map(res => ( <div key={res.id} className="bg-white p-3 rounded-md border flex items-start justify-between"> <div className="flex-grow"> <p className="font-semibold text-gray-900">{res.name} <span className="text-sm font-normal text-gray-600">({formatCurrency(res.hourlyCost || 0)}/h)</span></p> {res.company && <p className="text-sm text-blue-700">{res.company}</p>} {res.email && <p className="text-sm text-gray-600">{res.email}</p>} {res.phone && <p className="text-sm text-gray-600">{res.phone}</p>} {res.notes && <p className="text-xs text-gray-500 mt-1">{res.notes}</p>} </div> <div className="flex-shrink-0 flex gap-2 ml-4"> <button onClick={() => handleEdit(res)} className="text-blue-600 hover:text-blue-800"><Edit size={16} /></button> <button onClick={() => confirmDelete(res.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button> </div> </div> ))} </div> </div> </> );
};

const ProjectForm = ({ project, onDone, db, userId }) => {
    const [name, setName] = useState(project ? project.name : '');
    const [color, setColor] = useState(project ? project.color : '#a855f7');
    const handleSubmit = async (e) => { e.preventDefault(); if (name.trim() === '') return; const projectData = { name: name.trim(), color }; try { if (project && project.id) { await updateDoc(doc(db, `/artifacts/${appId}/public/data/projects`, project.id), projectData); } else { await addDoc(collection(db, `/artifacts/${appId}/public/data/projects`), {...projectData, createdAt: new Date().toISOString(), ownerId: userId }); } onDone(); } catch(error) { console.error("Errore salvataggio progetto", error); } };
    return ( <form onSubmit={handleSubmit} className="space-y-4"> <div> <label htmlFor="project-name" className="block text-sm font-medium text-gray-700">Nome Progetto</label> <input id="project-name" type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> <div> <label htmlFor="project-color" className="block text-sm font-medium text-gray-700">Colore Progetto</label> <input id="project-color" type="color" value={color} onChange={e => setColor(e.target.value)} className="mt-1 w-full h-10 p-1 border border-gray-300 rounded-md"/> </div> <div className="flex justify-end pt-4 gap-2"> <button type="button" onClick={onDone} className="bg-gray-300 text-gray-800 px-4 py-2 rounded-md">Annulla</button> <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md">{project && project.id ? 'Salva Modifiche' : 'Crea Progetto'}</button> </div> </form> );
};

const TaskForm = ({ db, projects, task, resources, allTasks, onDone, selectedProjectIdForNew }) => {
    const getProjectColor = useCallback((pId) => projects.find(p => p.id === pId)?.color || '#3b82f6', [projects]);
    
    const [name, setName] = useState(task ? task.name : '');
    const [projectId, setProjectId] = useState(task ? task.projectId : selectedProjectIdForNew || (projects.length > 0 ? projects[0].id : ''));
    const [startDate, setStartDate] = useState(task ? task.startDate : new Date().toISOString().split('T')[0]);
    const [duration, setDuration] = useState(task ? (calculateDaysDifference(task.startDate, task.endDate) + 1) : 1);
    const [endDate, setEndDate] = useState(() => { const start = new Date(task ? task.startDate : new Date().toISOString().split('T')[0]); start.setDate(start.getDate() + duration - 1); return start.toISOString().split('T')[0]; });
    const [dateWarning, setDateWarning] = useState(null);
    const [completionPercentage, setCompletionPercentage] = useState(task ? task.completionPercentage || 0 : 0);
    const [dailyHours, setDailyHours] = useState(task ? task.dailyHours || 8 : 8);
    const [taskColor, setTaskColor] = useState(task ? task.taskColor : getProjectColor(projectId));
    const [assignedResources, setAssignedResources] = useState(task ? task.assignedResources || [] : []);
    const [dependencies, setDependencies] = useState(task ? task.dependencies || [] : []);

    useEffect(() => { if (!task) { setTaskColor(getProjectColor(projectId)); } }, [projectId, task, getProjectColor]);
    useEffect(() => { setDateWarning(checkDateWarning(endDate)); }, [endDate]);

    const handleStartDateChange = (date) => { setStartDate(date); const newEndDate = new Date(date); newEndDate.setDate(newEndDate.getDate() + duration - 1); setEndDate(newEndDate.toISOString().split('T')[0]); };
    const handleDurationChange = (value) => { const newDur = parseInt(value, 10); if (newDur > 0) { setDuration(newDur); const newEndDate = new Date(startDate); newEndDate.setDate(newEndDate.getDate() + newDur - 1); setEndDate(newEndDate.toISOString().split('T')[0]); } };
    const handleEndDateChange = (date) => { setEndDate(date); const newDuration = calculateDaysDifference(startDate, date) + 1; if (newDuration > 0) { setDuration(newDuration); } };
    
    useEffect(() => {
        if (dependencies?.length > 0) {
            const latestPredecessorEndDate = dependencies.reduce((latest, depId) => { const predecessor = allTasks.find(t => t.id === depId); if (!predecessor) return latest; const predecessorEndDate = new Date(predecessor.endDate); return predecessorEndDate > latest ? predecessorEndDate : latest; }, new Date(0));
            if (latestPredecessorEndDate > new Date(0)) {
                const newStartDate = new Date(latestPredecessorEndDate); newStartDate.setDate(newStartDate.getDate() + 1);
                if (newStartDate > new Date(startDate)) { handleStartDateChange(newStartDate.toISOString().split('T')[0]); }
            }
        }
    }, [dependencies, allTasks, startDate]);

    const handleSubmit = async (e) => { e.preventDefault(); const taskData = { name, startDate, endDate, completionPercentage: Number(completionPercentage), dailyHours: Number(dailyHours), taskColor, assignedResources, dependencies, projectId }; try { if (task) { await updateDoc(doc(db, `/artifacts/${appId}/public/data/tasks`, task.id), taskData); } else { await addDoc(collection(db, `/artifacts/${appId}/public/data/tasks`), { ...taskData, order: allTasks.filter(t => t.projectId === projectId).length }); } onDone(); } catch (error) { console.error("Errore salvataggio task:", error); } };
    const handleResourceToggle = (resourceId) => setAssignedResources(prev => prev.includes(resourceId) ? prev.filter(id => id !== resourceId) : [...prev, resourceId]);
    const handleDependencyToggle = (taskId) => setDependencies(prev => prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]);

    const availableTasksForDependency = useMemo(() => allTasks.filter(t => t.projectId === projectId && (!task || t.id !== task.id)), [allTasks, projectId, task]);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-sm font-medium text-gray-700">Progetto</label> <select value={projectId} onChange={e => setProjectId(e.target.value)} required disabled={!!task} className="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md disabled:bg-gray-100"> <option value="" disabled>-- Seleziona --</option> {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)} </select> </div> <div> <label className="block text-sm font-medium text-gray-700">Nome Attività</label> <input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md" /> </div> </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end"> <div> <label className="block text-sm font-medium">Data Inizio</label> <DatePicker value={startDate} onChange={handleStartDateChange} /> </div> <div> <label className="block text-sm font-medium">Data Fine</label> <DatePicker value={endDate} onChange={handleEndDateChange} /> </div> </div>
            <div> <label className="block text-sm font-medium">Durata (giorni)</label> <div className="flex items-center gap-2"> <input type="range" min="1" max="365" value={duration} onChange={(e) => handleDurationChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" /> <input type="number" min="1" max="1000" value={duration} onChange={(e) => handleDurationChange(e.target.value)} className="w-24 px-2 py-1 bg-white border border-gray-300 rounded-md" /></div> </div>
            {dateWarning && <div className="p-2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 text-sm flex items-center gap-2"> <AlertTriangle size={16}/> {dateWarning}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-sm font-medium">Ore/giorno</label> <input type="number" min="1" max="24" value={dailyHours} onChange={e => setDailyHours(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md" /> </div> <div> <label className="block text-sm font-medium">Colore Attività</label> <input type="color" value={taskColor} onChange={e => setTaskColor(e.target.value)} className="mt-1 w-full h-10 p-1 border border-gray-300 rounded-md"/> </div> </div>
            <div> <label className="block text-sm font-medium">Completamento: {completionPercentage}%</label> <div className="flex items-center gap-2"> <input type="range" min="0" max="100" value={completionPercentage} onChange={e => setCompletionPercentage(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" /> <input type="number" min="0" max="100" value={completionPercentage} onChange={e => setCompletionPercentage(e.target.value)} className="w-20 px-2 py-1 bg-white border border-gray-300 rounded-md" /> <button type="button" onClick={() => setCompletionPercentage(100)} className="bg-green-100 text-green-800 px-3 py-1 rounded-md text-sm hover:bg-green-200"><CheckCircle size={16}/></button></div> </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <h4 className="text-sm font-medium mb-2">Predecessori</h4> <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1 bg-white"> {availableTasksForDependency.length > 0 ? availableTasksForDependency.map(t => ( <div key={t.id}> <label className="flex items-center space-x-2"> <input type="checkbox" checked={dependencies?.includes(t.id)} onChange={() => handleDependencyToggle(t.id)} className="rounded text-blue-500" /> <span>{t.name}</span> </label> </div> )) : <p className="text-xs text-gray-500">Nessuna altra attività.</p>} </div> </div> <div> <h4 className="text-sm font-medium mb-2">Risorse Assegnate</h4> <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1 bg-white"> {resources.map(res => ( <div key={res.id}> <label className="flex items-center space-x-2"> <input type="checkbox" checked={assignedResources?.includes(res.id)} onChange={() => handleResourceToggle(res.id)} className="rounded text-blue-500" /> <span>{res.name}</span> </label> </div> ))} </div> </div> </div>
            <div className="flex justify-end pt-4"> <button type="button" onClick={onDone} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md mr-2">Annulla</button> <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md">Salva Attività</button> </div>
        </form>
    );
};

const ActivityReportView = ({ projectsWithData, onExportPDF }) => {
    const reportData = useMemo(() => {
        if (!projectsWithData) return { dueTodayTasks: [], dueInThreeDaysTasks: [], otherTasks: [] };
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const threeDaysFromNow = new Date(); threeDaysFromNow.setDate(today.getDate() + 3);

        const allEnrichedTasks = projectsWithData.flatMap(project =>
            project.tasks.map(task => ({
                ...task,
                projectName: project.name || 'N/D',
                projectColor: project.color || '#cccccc',
            }))
        );

        const dueTodayTasks = allEnrichedTasks.filter(task => { const d = new Date(task.endDate); d.setHours(0,0,0,0); return d.getTime() === today.getTime(); }).sort((a,b) => a.projectName.localeCompare(b.projectName));
        const dueInThreeDaysTasks = allEnrichedTasks.filter(task => { const d = new Date(task.endDate); d.setHours(0,0,0,0); return d > today && d <= threeDaysFromNow; }).sort((a,b) => new Date(a.endDate) - new Date(b.endDate));
        const otherTasks = allEnrichedTasks.filter(task => { const d = new Date(task.endDate); d.setHours(0,0,0,0); return d.getTime() !== today.getTime() && (d < today || d > threeDaysFromNow) }).sort((a,b) => new Date(a.endDate) - new Date(b.endDate));
        
        return { dueTodayTasks, dueInThreeDaysTasks, otherTasks };
    }, [projectsWithData]);

    const renderTaskRow = (task) => ( <tr key={task.id}><td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900"><div className="flex items-center"><span className="w-3 h-3 rounded-full mr-3 flex-shrink-0" style={{backgroundColor: task.projectColor}}></span><span>{task.name}</span></div><div className="text-xs text-gray-500 pl-6">{task.projectName}</div></td><td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(task.endDate).toLocaleDateString('it-IT')}</td><td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{task.assigned.map(r => r.name).join(', ') || 'N/A'}</td><td className="px-4 py-4 whitespace-nowrap text-sm">{task.totalTaskHours.toFixed(0)}h</td><td className="px-4 py-4 whitespace-nowrap text-sm">{formatCurrency(task.totalEstimatedCost)}<br/><span className="text-xs text-gray-500">({formatCurrency(task.spentCost)})</span></td><td className="px-4 py-4 whitespace-nowrap"><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${task.completionPercentage || 0}%`}}></div></div><span className="text-xs text-gray-500">{task.completionPercentage || 0}%</span></td></tr> );

    return (
        <div className="p-4 md:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6"> <h2 className="text-2xl font-bold text-gray-800">Report Attività per Scadenza</h2> <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"> <FileDown size={16}/> Esporta PDF </button> </div>
            <div id="activity-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività / Progetto</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scadenza</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risorse</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ore Stimate</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Stimato/Sostenuto</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avanzamento</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {reportData.dueTodayTasks.length > 0 && <tr className="bg-red-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-red-800">IN SCADENZA OGGI</td></tr>}
                        {reportData.dueTodayTasks.map(renderTaskRow)}
                        {reportData.dueInThreeDaysTasks.length > 0 && <tr className="bg-yellow-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-yellow-800">IN SCADENZA A BREVE (3 GIORNI)</td></tr>}
                        {reportData.dueInThreeDaysTasks.map(renderTaskRow)}
                        {reportData.otherTasks.length > 0 && <tr className="bg-gray-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-gray-700">ALTRE ATTIVITÀ</td></tr>}
                        {reportData.otherTasks.map(renderTaskRow)}
                        {reportData.dueTodayTasks.length === 0 && reportData.dueInThreeDaysTasks.length === 0 && reportData.otherTasks.length === 0 && ( <tr><td colSpan="6" className="px-6 py-4 text-center text-sm text-gray-500">Nessuna attività da mostrare.</td></tr> )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AssignmentReportView = ({ projectsWithData, resources, onExportPDF }) => {
    const reportData = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return resources.map(resource => {
            const allTasks = projectsWithData.flatMap(p => p.tasks);
            const assignedTasks = allTasks
                .filter(task => task.assignedResources?.includes(resource.id))
                .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

            let dailyWorkload = 0;
            const activeTasksToday = allTasks.filter(task => {
                const startDate = new Date(task.startDate);
                const endDate = new Date(task.endDate);
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(0, 0, 0, 0);
                return task.assignedResources?.includes(resource.id) &&
                       today >= startDate && today <= endDate;
            });

            activeTasksToday.forEach(task => {
                const numResources = task.assignedResources?.length || 1;
                const hoursPerResource = (task.dailyHours || 8) / numResources;
                dailyWorkload += hoursPerResource;
            });

            return {
                ...resource,
                assignedTasks,
                dailyWorkload,
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
    }, [projectsWithData, resources]);

    return (
        <div className="p-4 md:p-6 lg:p-8">
             <div className="flex justify-between items-center mb-6"> <h2 className="text-2xl font-bold text-gray-800">Report Assegnazioni Risorse</h2> <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"> <FileDown size={16}/> Esporta PDF </button> </div>
            <div id="assignment-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                 {reportData.map(resource => (
                    <div key={resource.id} className="mb-8">
                        <div className="p-3 bg-gray-100 border-b-2 border-gray-300">
                           <h3 className="text-lg font-bold text-gray-800">{resource.name}</h3>
                           <p className="text-sm text-gray-600">Carico di lavoro odierno stimato: <span className="font-bold">{resource.dailyWorkload.toFixed(1)} ore</span></p>
                        </div>
                        <table className="min-w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="w-1/3 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività</th>
                                    <th className="w-1/3 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progetto</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scadenza</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avanzamento</th>
                                </tr>
                            </thead>
                             <tbody className="bg-white divide-y divide-gray-200">
                                {resource.assignedTasks.length > 0 ? resource.assignedTasks.map(task => (
                                    <tr key={task.id}>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{task.name}</td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm"><div className="flex items-center"><span className="w-3 h-3 rounded-full mr-2" style={{backgroundColor: task.projectColor}}></span>{task.projectName}</div></td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm">{new Date(task.endDate).toLocaleDateString('it-IT')}</td>
                                        <td className="px-4 py-4 whitespace-nowrap"><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${task.completionPercentage || 0}%`}}></div></div><span className="text-xs text-gray-500">{task.completionPercentage || 0}%</span></td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan="4" className="px-4 py-4 text-sm text-gray-500 italic">Nessuna attività assegnata.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                 ))}
            </div>
        </div>
    );
};

const CostReportView = ({ projectsWithData, onExportPDF }) => {
    const { projects, grandTotalCost, grandSpentCost } = useMemo(() => {
        if (!projectsWithData) return { projects: [], grandTotalCost: 0, grandSpentCost: 0 };
        let totalCost = 0;
        let spentCost = 0;
        const processedProjects = projectsWithData.map(p => {
            totalCost += p.projectTotalCost || 0;
            spentCost += p.projectSpentCost || 0;
            return p;
        });
        return { projects: processedProjects, grandTotalCost: totalCost, grandSpentCost: spentCost };
    }, [projectsWithData]);
    
    return (
        <div className="p-4 md:p-6 lg:p-8">
             <div className="flex justify-between items-center mb-6"> <h2 className="text-2xl font-bold text-gray-800">Report Costi</h2> <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"> <FileDown size={16}/> Esporta PDF </button> </div>
            <div id="cost-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risorse</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Stimato</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Sostenuto</th></tr></thead>
                     <tbody className="bg-white divide-y divide-gray-200">
                        {projects.flatMap(project => [
                            <tr key={project.id} className="bg-gray-100"><td colSpan="4" className="px-6 py-3 text-sm font-bold text-gray-900" style={{backgroundColor: project.color, color: 'white'}}><div className="flex justify-between"><span>{project.name}</span><span>{project.projectCompletionPercentage?.toFixed(1) || '0.0'}%</span></div></td></tr>,
                            ...(project.tasks.length > 0 ? project.tasks.map(task => ( <tr key={task.id}><td className="px-6 py-4 whitespace-nowrap"><p className="text-sm font-medium text-gray-900">{task.name}</p><p className="text-sm text-gray-500">{task.completionPercentage || 0}% completato</p></td><td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.assigned.map(r => r.name).join(', ') || 'N/A'}</td><td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">{formatCurrency(task.totalEstimatedCost)}</td><td className="px-6 py-4 whitespace-nowrap text-right text-sm">{formatCurrency(task.spentCost)}</td></tr> )) : [ <tr key={`${project.id}-empty`}><td colSpan="4" className="px-6 py-4 text-sm text-gray-500 italic">Nessuna attività.</td></tr> ]),
                            <tr key={`${project.id}-total`} className="bg-gray-50"><td colSpan="2" className="px-6 py-2 text-sm font-semibold text-right">Totale Progetto</td><td className="px-6 py-2 text-right text-sm font-semibold">{formatCurrency(project.projectTotalCost)}</td><td className="px-6 py-2 text-right text-sm font-semibold">{formatCurrency(project.projectSpentCost)}</td></tr>
                        ])}
                    </tbody>
                    <tfoot className="bg-gray-200"><tr><td colSpan="2" className="px-6 py-4 text-base font-bold text-right">TOTALE GENERALE</td><td className="px-6 py-4 text-right text-base font-bold">{formatCurrency(grandTotalCost)}</td><td className="px-6 py-4 text-right text-base font-bold">{formatCurrency(grandSpentCost)}</td></tr></tfoot>
                </table>
            </div>
        </div>
    );
};

// --- VISTA MASTER ---
const MainDashboard = ({ projects, tasks, resources, db, userId }) => {
    const [view, setView] = useState('gantt'); const [isLoading, setIsLoading] = useState(false); const [loadingMessage, setLoadingMessage] = useState(''); const [notification, setNotification] = useState({ message: '', type: 'info' }); const [isTaskModalOpen, setIsTaskModalOpen] = useState(false); const [isResourceModalOpen, setIsResourceModalOpen] = useState(false); const [isProjectModalOpen, setIsProjectModalOpen] = useState(false); const [editingTask, setEditingTask] = useState(null); const [editingProject, setEditingProject] = useState(null); const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false); const [importFile, setImportFile] = useState(null); const [selectedProjectId, setSelectedProjectId] = useState(null); const ganttContentRef = useRef(null); const dragInfo = useRef({}); const fileInputRef = useRef(null);
    const [itemToDelete, setItemToDelete] = useState(null);

    const projectsWithData = useMemo(() => {
        if (!projects || !tasks || !resources) return [];
        const taskMap = {};
        tasks.forEach(task => { const startDate = new Date(task.startDate); const endDate = new Date(task.endDate); const duration = calculateDaysDifference(startDate, endDate) + 1; taskMap[task.id] = { ...task, startDate, endDate, duration: duration > 0 ? duration : 1 }; });
        for (let i = 0; i < tasks.length * 2; i++) {
             tasks.forEach(task => {
                if (task.dependencies && task.dependencies.length > 0) {
                    let maxPredecessorEndDate = new Date(0);
                    task.dependencies.forEach(depId => { const predecessor = taskMap[depId]; if (predecessor && predecessor.endDate > maxPredecessorEndDate) maxPredecessorEndDate = predecessor.endDate; });
                    if (maxPredecessorEndDate > new Date(0)) {
                        const newStartDate = new Date(maxPredecessorEndDate); newStartDate.setDate(newStartDate.getDate() + 1);
                        if (newStartDate > taskMap[task.id].startDate) { const currentDuration = taskMap[task.id].duration; taskMap[task.id].startDate = newStartDate; const newEndDate = new Date(newStartDate); newEndDate.setDate(newEndDate.getDate() + currentDuration - 1); taskMap[task.id].endDate = newEndDate; }
                    }
                }
            });
        }
        const processedTasks = Object.values(taskMap);
        
        return projects.map(p => { 
            const projectTasks = processedTasks.filter(t => t.projectId === p.id);
            let totalDuration = 0; let weightedCompletion = 0; let projectTotalCost = 0; let projectSpentCost = 0; let projectTotalHours = 0; let projectWorkedHours = 0;

            const enrichedTasks = projectTasks.map(task => {
                const duration = task.duration || 1;
                const completion = task.completionPercentage || 0;
                const dailyHours = task.dailyHours || 8;
                const totalTaskHours = duration * dailyHours;
                const workedHours = totalTaskHours * (completion / 100);
                const assigned = task.assignedResources?.map(resId => resources.find(r => r.id === resId)).filter(Boolean) || [];
                const combinedHourlyRate = assigned.reduce((sum, res) => sum + (res.hourlyCost || 0), 0);
                const totalEstimatedCost = totalTaskHours * combinedHourlyRate;
                const spentCost = totalEstimatedCost * (completion / 100);

                totalDuration += duration;
                weightedCompletion += duration * completion;
                projectTotalCost += totalEstimatedCost;
                projectSpentCost += spentCost;
                projectTotalHours += totalTaskHours;
                projectWorkedHours += workedHours;

                return {...task, assigned, totalTaskHours, workedHours, totalEstimatedCost, spentCost };
            });

            const projectCompletionPercentage = totalDuration > 0 ? weightedCompletion / totalDuration : 0;
            return { ...p, tasks: enrichedTasks.sort((a,b) => (a.order || 0) - (b.order || 0)), projectCompletionPercentage, projectTotalCost, projectSpentCost, projectTotalHours, projectWorkedHours };
        }); 
    }, [tasks, projects, resources]);

    const flatTasksSorted = useMemo(() => projectsWithData.flatMap(p => p.tasks), [projectsWithData]);
    const { overallStartDate, totalDays } = useMemo(() => { if (flatTasksSorted.length === 0) return { overallStartDate: new Date(), totalDays: 30 }; const startDates = flatTasksSorted.map(t => t.startDate); const endDates = flatTasksSorted.map(t => t.endDate); const minDate = new Date(Math.min(...startDates.filter(d => d && !isNaN(d)))); const maxDate = new Date(Math.max(...endDates.filter(d => d && !isNaN(d)))); if (!minDate || !maxDate || isNaN(minDate) || isNaN(maxDate)) return { overallStartDate: new Date(), totalDays: 30 }; const diff = calculateDaysDifference(minDate, maxDate) + 5; return { overallStartDate: minDate, totalDays: diff > 30 ? diff : 30 }; }, [flatTasksSorted]);
    const dateHeaders = useMemo(() => { const headers = []; let currentDate = new Date(overallStartDate); currentDate.setDate(currentDate.getDate() - 1); for (let i = 0; i < totalDays + 2; i++) { headers.push(new Date(currentDate)); currentDate.setDate(currentDate.getDate() + 1); } return headers; }, [overallStartDate, totalDays]);

    const getResourceById = useCallback((id) => resources.find(r => r.id === id), [resources]);
    const handleEditTask = (task) => { setEditingTask(tasks.find(t=>t.id === task.id)); setIsTaskModalOpen(true); };
    const handleEditProject = (project) => { setEditingProject(project); setIsProjectModalOpen(true); };
    
    const handleOpenNewProjectModal = () => { const existingColors = projects.map(p => p.color); let newColor; do { newColor = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`; } while (existingColors.includes(newColor)); setEditingProject({ name: '', color: newColor }); setIsProjectModalOpen(true); };
    
    const confirmDeleteItem = (item, type) => setItemToDelete({item, type});
    
    const handleDeleteItem = async () => {
        if (!itemToDelete) return;
        const { item, type } = itemToDelete;
        setIsLoading(true); setLoadingMessage("Cancellazione...");
        try {
            if (type === 'task') {
                const batch = writeBatch(db);
                const tasksToUpdate = tasks.filter(t => t.dependencies?.includes(item.id));
                tasksToUpdate.forEach(t => { const taskRef = doc(db, `/artifacts/${appId}/public/data/tasks`, t.id); batch.update(taskRef, { dependencies: t.dependencies.filter(depId => depId !== item.id) }); });
                const taskRef = doc(db, `/artifacts/${appId}/public/data/tasks`, item.id); batch.delete(taskRef); await batch.commit();
                setNotification({message: "Attività eliminata.", type: "success"});
            } else if (type === 'project') {
                const batch = writeBatch(db);
                const tasksQuery = query(collection(db, `/artifacts/${appId}/public/data/tasks`), where("projectId", "==", item.id));
                const tasksSnapshot = await getDocs(tasksQuery);
                tasksSnapshot.forEach(d => batch.delete(d.ref));
                const projectRef = doc(db, `/artifacts/${appId}/public/data/projects`, item.id); batch.delete(projectRef); await batch.commit();
                setNotification({message: "Progetto e tutte le sue attività sono stati eliminati.", type: "success"});
            }
        } catch (error) { console.error("Errore durante l'eliminazione:", error); setNotification({message: `Errore: ${error.message}`, type: "error"});
        } finally { setItemToDelete(null); setIsLoading(false); }
    };
    
    const handleDragStart = (e, task, type) => { e.dataTransfer.effectAllowed = 'move'; dragInfo.current = { taskId: task.id, type, initialX: e.clientX, initialStartDate: task.startDate, initialEndDate: task.endDate }; };
    const handleGanttDrop = async (e) => { e.preventDefault(); const { taskId, type, initialX, initialStartDate, initialEndDate } = dragInfo.current; if (!taskId) return; const pixelsPerDay = 40; const dateOffset = Math.round((e.clientX - initialX) / pixelsPerDay); let newStartDate, newEndDate; const taskRef = doc(db, `/artifacts/${appId}/public/data/tasks`, taskId); if (type === 'move') { const duration = calculateDaysDifference(initialStartDate, initialEndDate); newStartDate = new Date(initialStartDate); newStartDate.setDate(newStartDate.getDate() + dateOffset); newEndDate = new Date(newStartDate); newEndDate.setDate(newEndDate.getDate() + duration); } else if (type === 'resize-end') { newStartDate = new Date(initialStartDate); newEndDate = new Date(initialEndDate); newEndDate.setDate(newEndDate.getDate() + dateOffset); if (newEndDate < newStartDate) newEndDate = newStartDate; } else if (type === 'resize-start') { newEndDate = new Date(initialEndDate); newStartDate = new Date(initialStartDate); newStartDate.setDate(newStartDate.getDate() + dateOffset); if (newStartDate > newEndDate) newStartDate = newEndDate; } else { return; } try { await updateDoc(taskRef, { startDate: newStartDate.toISOString().split('T')[0], endDate: newEndDate.toISOString().split('T')[0] }); } catch(error) { console.error("Errore aggiornamento task:", error); } dragInfo.current = {}; };
    const exportData = () => { const dataToExport = { projects, tasks, resources, exportedAt: new Date().toISOString() }; const dataStr = JSON.stringify(dataToExport, null, 2); const blob = new Blob([dataStr], {type: "application/json"}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `project_data_backup_${new Date().toISOString().split('T')[0]}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); setNotification({message: "Esportazione completata.", type: "success"}); };
    const handleFileImportChange = (e) => { const file = e.target.files[0]; if (file) { setImportFile(file); setIsImportConfirmOpen(true); } e.target.value = null; };
    const importData = async () => { if (!importFile) return; setIsLoading(true); setLoadingMessage("Importazione in corso..."); const reader = new FileReader(); reader.onload = async (e) => { try { const data = JSON.parse(e.target.result); if (!data.projects || !data.tasks || !data.resources) { throw new Error("Formato file non valido."); } setLoadingMessage("Cancellazione dati esistenti..."); const collectionsToDelete = ['tasks', 'resources', 'projects']; for (const coll of collectionsToDelete) { const snapshot = await getDocs(collection(db, `/artifacts/${appId}/public/data/${coll}`)); const batch = writeBatch(db); snapshot.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); } setLoadingMessage("Importazione nuovi dati..."); const importBatch = writeBatch(db); data.projects.forEach(p => importBatch.set(doc(db, `/artifacts/${appId}/public/data/projects`, p.id), p)); data.tasks.forEach(t => importBatch.set(doc(db, `/artifacts/${appId}/public/data/tasks`, t.id), t)); data.resources.forEach(r => importBatch.set(doc(db, `/artifacts/${appId}/public/data/resources`, r.id), r)); await importBatch.commit(); setNotification({message: "Importazione completata con successo!", type: "success"}); } catch (error) { console.error("Errore durante l'importazione:", error); setNotification({message: `Errore importazione: ${error.message}`, type: "error"}); } finally { setIsLoading(false); setImportFile(null); setIsImportConfirmOpen(false); } }; reader.readAsText(importFile); };
    const exportToPDF = (reportType) => { const { jsPDF } = window.jspdf; if (typeof jsPDF === 'undefined' || (reportType==='gantt' && typeof window.html2canvas === 'undefined')) { alert("Libreria PDF non ancora caricata. Riprova tra un momento."); return; } setIsLoading(true); setLoadingMessage(`Esportazione ${reportType}...`); const timestamp = new Date().toLocaleString('sv-SE').replace(/ /g, '_').replace(/:/g, '-'); if(reportType === 'cost' || reportType === 'activity' || reportType === 'assignment') { const content = document.getElementById(`${reportType}-report-content`); const title = reportType === 'cost' ? 'Report Costi' : reportType === 'activity' ? 'Report Attività' : 'Report Assegnazioni'; const doc = new jsPDF(); doc.autoTable({ html: `#${reportType}-report-content table`, startY: 20, didParseCell: function(data) { if (data.cell.raw.nodeName === 'TD') { data.cell.styles.fontStyle = 'normal'; data.cell.styles.halign = data.cell.raw.style.textAlign || 'left'; } if (data.cell.raw.nodeName === 'TH') { data.cell.styles.fontStyle = 'bold'; } } }); doc.text(title, 14, 15); doc.save(`report_${reportType}_${timestamp}.pdf`); setIsLoading(false); } else if (reportType === 'gantt') { const ganttElement = ganttContentRef.current; window.html2canvas(ganttElement, { useCORS: true, scale: 1.5, width: ganttElement.scrollWidth, height: ganttElement.scrollHeight, windowWidth: ganttElement.scrollWidth, windowHeight: ganttElement.scrollHeight, }).then(canvas => { const imgData = canvas.toDataURL('image/png'); const imgWidth = 280; const pageHeight = 190; const imgHeight = canvas.height * imgWidth / canvas.width; let heightLeft = imgHeight; const doc = new jsPDF('l', 'mm', 'a4'); let position = 10; doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight); heightLeft -= pageHeight; while (heightLeft > 0) { position = heightLeft - imgHeight + 10; doc.addPage(); doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight); heightLeft -= pageHeight; } doc.save(`gantt_chart_${timestamp}.pdf`); setIsLoading(false); }).catch(() => setIsLoading(false)); } };
    
    const ROW_HEIGHT = 64.8; const DAY_WIDTH = 40; const PROJECT_HEADER_HEIGHT = 48;
    const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
    const todayMarkerPosition = useMemo(() => { if (dateHeaders.length === 0) return -1; const ganttStartDate = dateHeaders[0]; return calculateDaysDifference(ganttStartDate, today) * DAY_WIDTH; }, [dateHeaders, today]);

    return (
        <div className="h-screen w-screen bg-gray-100 flex flex-col">
            {isLoading && <Loader message={loadingMessage} />}
            <Notification message={notification.message} type={notification.type} onClose={() => setNotification({message: ''})} />
            <header className="p-4 border-b flex items-center justify-between bg-white shadow-sm flex-wrap gap-2">
                <div className="flex items-center gap-4"> <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1> <div className="flex items-center gap-1 rounded-lg bg-gray-200 p-1"> <button onClick={() => setView('gantt')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='gantt' ? 'bg-white shadow' : 'text-gray-600'}`}><LayoutDashboard size={16}/> Gantt</button> <button onClick={() => setView('assignmentReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='assignmentReport' ? 'bg-white shadow' : 'text-gray-600'}`}><ClipboardList size={16}/> Assegnazioni</button> <button onClick={() => setView('activityReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='activityReport' ? 'bg-white shadow' : 'text-gray-600'}`}><BarChart3 size={16}/> Attività</button> <button onClick={() => setView('costReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='costReport' ? 'bg-white shadow' : 'text-gray-600'}`}><BarChart3 size={16}/> Costi</button> </div> </div>
                <div className="flex items-center gap-2 flex-wrap"> <button onClick={exportData} className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 flex items-center gap-2 text-sm"><FileDown size={16}/> Esporta Dati</button> <button onClick={() => fileInputRef.current.click()} className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 flex items-center gap-2 text-sm"><FileUp size={16}/> Importa Dati</button> <input type="file" ref={fileInputRef} onChange={handleFileImportChange} accept=".json" className="hidden"/> <button onClick={handleOpenNewProjectModal} className="bg-purple-600 text-white px-3 py-2 rounded-md hover:bg-purple-700 flex items-center gap-2 text-sm"> <Plus size={16} /> Progetto </button> <button onClick={() => setIsResourceModalOpen(true)} className="bg-yellow-500 text-white px-3 py-2 rounded-md hover:bg-yellow-600 flex items-center gap-2 text-sm"> <Users size={16} /> Risorse </button> <button onClick={() => { setEditingTask(null); setIsTaskModalOpen(true); }} className="bg-blue-500 text-white px-3 py-2 rounded-md hover:bg-blue-600 flex items-center gap-2 text-sm"> <Plus size={16} /> Attività </button> </div>
            </header>
            <main className="flex-grow overflow-auto">
                {view === 'gantt' ? ( <div ref={ganttContentRef} className="flex h-full min-w-max"> <div className="w-96 border-r bg-gray-50 flex-shrink-0"> <div className="h-12 flex items-center justify-between px-4 border-b bg-gray-100 font-semibold text-gray-700 sticky top-0 z-20">Progetti <button onClick={() => exportToPDF('gantt')} className="text-blue-600 hover:text-blue-800 p-1"><FileDown size={18}/></button></div> <div className="divide-y divide-gray-200"> {projectsWithData.map(project => ( <div key={project.id}> <div onClick={() => setSelectedProjectId(project.id)} className={`p-2 flex items-center justify-between px-4 sticky top-12 z-10 cursor-pointer transition-all ${selectedProjectId === project.id ? 'bg-blue-200 border-l-4 border-blue-600' : 'bg-gray-200'}`} style={{minHeight: `${PROJECT_HEADER_HEIGHT}px`}}> <div className="flex items-center gap-3 flex-grow"> <span className="w-4 h-4 rounded-full flex-shrink-0" style={{backgroundColor: project.color}}></span> <div className="flex-grow"><h3 className="font-bold text-gray-800">{project.name}</h3> <div className="w-full bg-gray-300 rounded-full h-1.5 mt-1"><div className="bg-green-500 h-1.5 rounded-full" style={{width: `${project.projectCompletionPercentage.toFixed(0)}%`}}></div></div><span className="text-xs text-gray-500">{project.projectCompletionPercentage.toFixed(1)}%</span></div> </div> <div className="flex items-center gap-2 flex-shrink-0"><button onClick={(e) => {e.stopPropagation(); handleEditProject(project)}} className="text-gray-500 hover:text-blue-600"><Edit size={16}/></button><button onClick={(e) => {e.stopPropagation(); confirmDeleteItem(project, 'project')}} className="text-gray-500 hover:text-red-600"><Trash2 size={16}/></button></div> </div> {project.tasks.map(task => ( <div key={task.id} className="p-2 pl-9 flex items-center group" style={{height: `${ROW_HEIGHT}px`}} onDoubleClick={() => handleEditTask(task)}> <div className="flex-grow"> <p className="font-medium text-gray-800">{task.name}</p> <div className="flex flex-wrap gap-1 mt-1"> {task.assignedResources?.map(resId => { const r = getResourceById(resId); return r ? <span key={resId} className="text-xs bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded-full">{r.name}</span> : null; })} </div> </div> <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity"> <button onClick={(e) => {e.stopPropagation(); confirmDeleteItem(task, 'task')}} className="p-1 text-gray-500 hover:text-red-600"> <Trash2 size={16}/> </button> </div> </div> ))} {project.tasks.length === 0 && <div className="pl-9 text-xs text-gray-500 italic h-10 flex items-center">Nessuna attività.</div>} </div> ))} </div> </div> <div className="flex-grow h-full overflow-x-scroll" onDragOver={(e)=>e.preventDefault()} onDrop={handleGanttDrop}> <div className="relative" style={{width: `${dateHeaders.length * DAY_WIDTH}px`, height: `${flatTasksSorted.length * ROW_HEIGHT + projectsWithData.length * PROJECT_HEADER_HEIGHT + 48}px`}}> <div className="sticky top-0 z-30 flex bg-gray-100 h-12 border-b"> {dateHeaders.map((date) => { const isToday = date.toDateString() === today.toDateString(); return (<div key={date.toISOString()} className={`w-10 text-center border-r flex-shrink-0 ${isToday ? 'bg-red-200 border-b-2 border-red-500' : ''}`}> <div className={`text-xs ${date.getDay() === 0 || date.getDay() === 6 ? 'text-red-500' : 'text-gray-500'}`}>{['D', 'L', 'M', 'M', 'G', 'V', 'S'][date.getDay()]}</div> <div className={`text-sm font-semibold ${isToday ? 'text-red-600' : 'text-gray-800'}`}>{date.getDate()}</div> </div>)})} </div> <div className="absolute top-12 left-0 h-full w-full pointer-events-none z-0"> {dateHeaders.map((date, index) => (<div key={index} className={`absolute top-0 bottom-0 w-10 border-r ${(date.getDay() === 0 || date.getDay() === 6) ? 'bg-gray-100/50' : ''}`} style={{ left: `${index * DAY_WIDTH}px` }}></div>))} {todayMarkerPosition >= 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30" style={{ left: `${todayMarkerPosition + DAY_WIDTH / 2}px`}}></div>} </div> <div className="absolute top-12 left-0 w-full h-full z-10 pointer-events-none"> <svg width="100%" height="100%"> <defs> <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4a5568" /></marker> </defs> {flatTasksSorted.map((task) => task.dependencies?.map(depId => { const predecessor = flatTasksSorted.find(t => t.id === depId); if (!predecessor) return null; let fromFlatIndex = flatTasksSorted.findIndex(t => t.id === predecessor.id); let toFlatIndex = flatTasksSorted.findIndex(t => t.id === task.id); let fromProjectCount = projectsWithData.filter((p, i) => projectsWithData.slice(0,i).reduce((acc,cur)=>acc+cur.tasks.length,0) <= fromFlatIndex).length; let toProjectCount = projectsWithData.filter((p, i) => projectsWithData.slice(0,i).reduce((acc,cur)=>acc+cur.tasks.length,0) <= toFlatIndex).length; const fromY = fromFlatIndex * ROW_HEIGHT + fromProjectCount * PROJECT_HEADER_HEIGHT + ROW_HEIGHT/2; const toY = toFlatIndex * ROW_HEIGHT + toProjectCount * PROJECT_HEADER_HEIGHT + ROW_HEIGHT/2; const fromX = (calculateDaysDifference(dateHeaders[0], predecessor.endDate) + 1) * DAY_WIDTH - DAY_WIDTH / 2; const toX = calculateDaysDifference(dateHeaders[0], task.startDate) * DAY_WIDTH; const midX = fromX + 20; const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX - 8} ${toY}`; return <path key={`${depId}-${task.id}`} d={path} stroke="#4a5568" strokeWidth="2" fill="none" markerEnd="url(#arrow)" /> }))} </svg> </div> <div className="absolute top-12 left-0 w-full h-full z-20"> {projectsWithData.reduce((acc, project) => { const projectTop = acc.totalHeight; const projectHeader = <div key={`header-${project.id}`} className="absolute w-full h-12" style={{top: `${projectTop}px`}}></div>; const taskElements = project.tasks.map((task, taskIndex) => { const left = calculateDaysDifference(dateHeaders[0], task.startDate) * DAY_WIDTH; const width = task.duration * DAY_WIDTH; const top = projectTop + PROJECT_HEADER_HEIGHT + (taskIndex * ROW_HEIGHT); const bgColor = task.taskColor || project.color || '#3b82f6'; const textColorClass = getContrastingTextColor(bgColor); return ( <div key={task.id} className="absolute flex items-center" style={{ top: `${top}px`, height: `${ROW_HEIGHT}px`, left: `${left}px`, width: `${width}px` }} onDoubleClick={()=>handleEditTask(task)}> <div draggable onDragStart={(e) => handleDragStart(e, task, 'move')} className="h-8 rounded-md shadow-sm flex items-center w-full group relative" style={{ backgroundColor: bgColor }}> <div className="absolute top-0 left-0 h-full rounded-l-md" style={{width: `${task.completionPercentage || 0}%`, backgroundColor: 'rgba(0,0,0,0.2)'}}></div> <div className={`absolute px-2 text-sm truncate font-medium z-10 ${textColorClass}`}>{task.name}</div> <div draggable onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, task, 'resize-start'); }} className="absolute left-0 top-0 w-2 h-full cursor-ew-resize z-20" /> <div draggable onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, task, 'resize-end'); }} className="absolute right-0 top-0 w-2 h-full cursor-ew-resize z-20" /> </div> </div> ); }); acc.elements.push(projectHeader, ...taskElements); acc.totalHeight += PROJECT_HEADER_HEIGHT + (project.tasks.length * ROW_HEIGHT); return acc; }, {elements:[], totalHeight:0}).elements} </div> </div> </div> </div>
                ) : view === 'costReport' ? ( <CostReportView projectsWithData={projectsWithData} onExportPDF={() => exportToPDF('cost')} />
                ) : view === 'assignmentReport' ? ( <AssignmentReportView projectsWithData={projectsWithData} resources={resources} onExportPDF={() => exportToPDF('assignment')} /> )
                : ( <ActivityReportView projectsWithData={projectsWithData} onExportPDF={() => exportToPDF('activity')} /> )
                }
            </main>
             <Modal isOpen={isTaskModalOpen} onClose={() => setIsTaskModalOpen(false)} title={editingTask ? 'Modifica Attività' : 'Nuova Attività'}> <TaskForm db={db} projects={projects} task={editingTask} resources={resources} allTasks={tasks} onDone={() => setIsTaskModalOpen(false)} selectedProjectIdForNew={selectedProjectId} /> </Modal>
             <Modal isOpen={isResourceModalOpen} onClose={() => setIsResourceModalOpen(false)} title="Gestione Risorse"> <ResourceManagement resources={resources} db={db} /> </Modal>
             <Modal isOpen={isProjectModalOpen} onClose={() => {setEditingProject(null); setIsProjectModalOpen(false);}} title={editingProject && editingProject.id ? 'Modifica Progetto' : 'Nuovo Progetto'}> <ProjectForm project={editingProject} onDone={() => {setEditingProject(null); setIsProjectModalOpen(false);}} db={db} userId={userId} /> </Modal>
             <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Conferma Eliminazione"> <div><div className="p-4 bg-red-100 border-l-4 border-red-500 text-red-700"> <p className="font-bold">ATTENZIONE!</p><p>Stai per eliminare {itemToDelete?.type === 'project' ? `il progetto "${itemToDelete.item.name}" e tutte le sue attività` : `l'attività "${itemToDelete?.item.name}"`}. Questa azione è irreversibile.</p></div> <div className="flex justify-end mt-4 gap-2"> <button onClick={() => setItemToDelete(null)} className="bg-gray-300 px-4 py-2 rounded-md">Annulla</button> <button onClick={handleDeleteItem} className="bg-red-600 text-white px-4 py-2 rounded-md">Elimina</button></div></div></Modal>
             <Modal isOpen={isImportConfirmOpen} onClose={() => setIsImportConfirmOpen(false)} title="Conferma Importazione"> <div><div className="p-4 bg-red-100 border-l-4 border-red-500 text-red-700"> <p className="font-bold">ATTENZIONE!</p><p>Stai per sovrascrivere tutti i dati esistenti. Questa azione è irreversibile. Sei sicuro di voler continuare?</p></div> <div className="flex justify-end mt-4 gap-2"> <button onClick={() => setIsImportConfirmOpen(false)} className="bg-gray-300 px-4 py-2 rounded-md">Annulla</button> <button onClick={importData} className="bg-red-600 text-white px-4 py-2 rounded-md">Sì, sovrascrivi tutto</button></div></div></Modal>
        </div>
    );
};

// --- COMPONENTE APP ---
export default function App() {
    const [db, setDb] = useState(null); const [userId, setUserId] = useState(null); const [isAuthReady, setIsAuthReady] = useState(false); const [projects, setProjects] = useState([]); const [tasks, setTasks] = useState([]); const [resources, setResources] = useState([]);
    
    useEffect(() => {
        const scripts = [ { id: 'jspdf', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' }, { id: 'jspdf-autotable', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js' }, { id: 'html2canvas', src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' } ];
        scripts.forEach(scriptInfo => { if (!document.getElementById(scriptInfo.id)) { const script = document.createElement('script'); script.id = scriptInfo.id; script.src = scriptInfo.src; script.async = false; document.head.appendChild(script); } });
        
        try { if (Object.keys(firebaseConfig).length > 0) { const app = initializeApp(firebaseConfig); const firestore = getFirestore(app); const authInstance = getAuth(app); setDb(firestore); onAuthStateChanged(authInstance, async (user) => { if (user) { setUserId(user.uid); } else { try { if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) { await signInWithCustomToken(authInstance, __initial_auth_token); } else { await signInAnonymously(authInstance); } } catch (authError) { console.error("Errore auth:", authError); } } setIsAuthReady(true); }); } else { console.log("Config Firebase non disponibile."); setIsAuthReady(true); } } catch(e) { console.error("Errore init Firebase:", e); setIsAuthReady(true); }
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db) return;
        const unsubProjects = onSnapshot(query(collection(db, `/artifacts/${appId}/public/data/projects`)), snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubTasks = onSnapshot(query(collection(db, `/artifacts/${appId}/public/data/tasks`)), snap => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubResources = onSnapshot(query(collection(db, `/artifacts/${appId}/public/data/resources`)), snap => setResources(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        return () => { unsubProjects(); unsubTasks(); unsubResources(); };
    }, [isAuthReady, db]);

    if (!isAuthReady) { return <div className="h-screen w-screen flex justify-center items-center bg-gray-100"><div className="text-xl font-semibold">Caricamento Gestione Progetti...</div></div>; }
    
    return <MainDashboard projects={projects} tasks={tasks} resources={resources} db={db} userId={userId} />;
}
