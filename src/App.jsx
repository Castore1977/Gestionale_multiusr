import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, query, where, writeBatch, getDocs } from 'firebase/firestore';
import { ArrowRight, Plus, Users, Trash2, Edit, LayoutDashboard, BarChart3, X, AlertTriangle, FileDown, FileUp, CheckCircle, ClipboardList, StickyNote, LogOut, Percent } from 'lucide-react';

// --- CONFIGURAZIONE FIREBASE ---
const firebaseConfigString = import.meta.env.VITE_FIREBASE_CONFIG;
const firebaseConfig = firebaseConfigString ? JSON.parse(firebaseConfigString) : {
// INCOLLA QUI LA TUA CONFIGURAZIONE FIREBASE
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

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
    if (!hexcolor) return 'text-gray-100';
    if (hexcolor.startsWith('#')) { hexcolor = hexcolor.slice(1); }
    if (hexcolor.length === 3) { hexcolor = hexcolor.split('').map(char => char + char).join(''); }
    if (hexcolor.length !== 6) { return 'text-gray-100'; }
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'text-black' : 'text-gray-100';
};

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

// --- COMPONENTI UI GENERICI ---
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
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
const ResourceManagement = ({ resources, db, userId }) => {
    const [editingResource, setEditingResource] = useState(null);
    const [name, setName] = useState('');
    const [company, setCompany] = useState('');
    const [notes, setNotes] = useState('');
    const [hourlyCost, setHourlyCost] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [resourceToDelete, setResourceToDelete] = useState(null);

    const uniqueCompanies = useMemo(() => [...new Set(resources.map(r => r.company).filter(Boolean))], [resources]);
    const resetForm = () => { setEditingResource(null); setName(''); setCompany(''); setNotes(''); setHourlyCost(''); setEmail(''); setPhone(''); };
    const handleEdit = (resource) => { setEditingResource(resource); setName(resource.name); setCompany(resource.company || ''); setNotes(resource.notes || ''); setHourlyCost(resource.hourlyCost || ''); setEmail(resource.email || ''); setPhone(resource.phone || ''); };
    const handleSubmit = async () => { if (name.trim() === '' || !userId) return; const resourceData = { name: name.trim(), company: company.trim(), notes: notes.trim(), hourlyCost: Number(hourlyCost) || 0, email: email.trim(), phone: phone.trim() }; try { if (editingResource) { await updateDoc(doc(db, `users/${userId}/resources`, editingResource.id), resourceData); } else { await addDoc(collection(db, `users/${userId}/resources`), resourceData); } resetForm(); } catch (error) { console.error("Errore salvataggio risorsa:", error); } };
    const confirmDelete = (id) => { setResourceToDelete(id); setIsConfirmOpen(true); };
    const deleteResource = async () => { if (!resourceToDelete || !userId) return; try { await deleteDoc(doc(db, `users/${userId}/resources`, resourceToDelete)); } catch (error) { console.error("Errore eliminazione risorsa:", error); } finally { setIsConfirmOpen(false); setResourceToDelete(null); } };

    return ( <> <Modal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} title="Conferma Eliminazione"> <div> <p>Sei sicuro di voler eliminare questa risorsa?</p> <div className="flex justify-end mt-4"> <button onClick={() => setIsConfirmOpen(false)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded-md mr-2">Annulla</button> <button onClick={deleteResource} className="bg-red-600 text-white px-4 py-2 rounded-md">Elimina</button> </div> </div> </Modal> <div> <h4 className="text-lg font-medium text-gray-700 mb-3">{editingResource ? 'Modifica Risorsa' : 'Aggiungi Risorsa'}</h4> <div className="space-y-4 p-4 border rounded-md bg-gray-50 mb-6"> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-sm font-medium text-gray-700">Nome Risorsa</label> <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Rossi" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" required/> </div> <div> <label className="block text-sm font-medium text-gray-700">Società</label> <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" list="companies-datalist" /> <datalist id="companies-datalist">{uniqueCompanies.map(c => <option key={c} value={c} />)}</datalist> </div> <div> <label className="block text-sm font-medium text-gray-700">Email</label> <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mario.rossi@example.com" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> <div> <label className="block text-sm font-medium text-gray-700">Telefono</label> <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 1234567" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> <div> <label className="block text-sm font-medium text-gray-700">Costo Orario (€)</label> <input type="number" value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} placeholder="50" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" /> </div> </div> <div> <label className="block text-sm font-medium text-gray-700">Note</label> <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Specializzazione, contatto, etc." rows="2" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm"></textarea> </div> <div className="flex justify-end items-center gap-4"> {editingResource && (<button onClick={resetForm} className="text-sm text-gray-600 hover:underline">Annulla modifica</button>)} <button onClick={handleSubmit} className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center gap-2"> <Plus size={16} /> {editingResource ? 'Salva Modifiche' : 'Aggiungi Risorsa'} </button> </div> </div> <h4 className="text-lg font-medium text-gray-700 mb-3">Elenco Risorse</h4> <div className="space-y-2 max-h-60 overflow-y-auto"> {resources.map(res => ( <div key={res.id} className="bg-white p-3 rounded-md border flex items-start justify-between"> <div className="flex-grow"> <p className="font-semibold text-gray-900">{res.name} <span className="text-sm font-normal text-gray-600">({formatCurrency(res.hourlyCost || 0)}/h)</span></p> {res.company && <p className="text-sm text-blue-700">{res.company}</p>} {res.email && <p className="text-sm text-gray-600">{res.email}</p>} {res.phone && <p className="text-sm text-gray-600">{res.phone}</p>} {res.notes && <p className="text-xs text-gray-500 mt-1">{res.notes}</p>} </div> <div className="flex-shrink-0 flex gap-2 ml-4"> <button onClick={() => handleEdit(res)} className="text-blue-600 hover:text-blue-800"><Edit size={16} /></button> <button onClick={() => confirmDelete(res.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button> </div> </div> ))} </div> </div> </> );
};

const ProjectForm = ({ project, onDone, db, userId }) => {
    const [name, setName] = useState(project ? project.name : '');
    const [color, setColor] = useState(project ? project.color : '#a855f7');
    const [budget, setBudget] = useState(project ? project.budget || '' : '');
    const [extraCosts, setExtraCosts] = useState(project ? project.extraCosts || '' : '');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (name.trim() === '' || !userId) return;
        const projectData = {
            name: name.trim(),
            color,
            budget: Number(budget) || 0,
            extraCosts: Number(extraCosts) || 0,
        };
        try {
            if (project && project.id) {
                await updateDoc(doc(db, `users/${userId}/projects`, project.id), projectData);
            } else {
                await addDoc(collection(db, `users/${userId}/projects`), { ...projectData, createdAt: new Date().toISOString() });
            }
            onDone();
        } catch (error) {
            console.error("Errore salvataggio progetto", error);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="project-name" className="block text-sm font-medium text-gray-700">Nome Progetto</label>
                <input id="project-name" type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
            </div>
            <div>
                <label htmlFor="project-color" className="block text-sm font-medium text-gray-700">Colore Progetto</label>
                <input id="project-color" type="color" value={color} onChange={e => setColor(e.target.value)} className="mt-1 w-full h-10 p-1 border border-gray-300 rounded-md" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="project-budget" className="block text-sm font-medium text-gray-700">Budget (€)</label>
                    <input id="project-budget" type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="10000" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                </div>
                <div>
                    <label htmlFor="project-extra-costs" className="block text-sm font-medium text-gray-700">Altre Spese (€)</label>
                    <input id="project-extra-costs" type="number" value={extraCosts} onChange={e => setExtraCosts(e.target.value)} placeholder="500" className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                </div>
            </div>
            <div className="flex justify-end pt-4 gap-2">
                <button type="button" onClick={onDone} className="bg-gray-300 text-gray-800 px-4 py-2 rounded-md">Annulla</button>
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md">{project && project.id ? 'Salva Modifiche' : 'Crea Progetto'}</button>
            </div>
        </form>
    );
};

const TaskForm = ({ db, projects, task, resources, allTasks, onDone, selectedProjectIdForNew, userId }) => {
    const getProjectColor = useCallback((pId) => projects.find(p => p.id === pId)?.color || '#3b82f6', [projects]);
    
    const [name, setName] = useState(task ? task.name : '');
    const [projectId, setProjectId] = useState(task ? task.projectId : selectedProjectIdForNew || (projects.length > 0 ? projects[0].id : ''));
    const [startDate, setStartDate] = useState(task ? task.startDate : new Date().toISOString().split('T')[0]);
    const [duration, setDuration] = useState(task ? (calculateDaysDifference(task.startDate, task.endDate) + 1) : 1);
    const [endDate, setEndDate] = useState(() => { const start = new Date(task ? task.startDate : new Date().toISOString().split('T')[0]); start.setDate(start.getDate() + (task ? (calculateDaysDifference(task.startDate, task.endDate)) : 0)); return start.toISOString().split('T')[0]; });
    const [dateWarning, setDateWarning] = useState(null);
    const [completionPercentage, setCompletionPercentage] = useState(task ? task.completionPercentage || 0 : 0);
    const [taskColor, setTaskColor] = useState(task ? task.taskColor : getProjectColor(projectId));
    const [assignedResources, setAssignedResources] = useState(task ? task.assignedResources || [] : []);
    const [dependencies, setDependencies] = useState(task ? task.dependencies || [] : []);
    const [notes, setNotes] = useState(task ? task.notes || '' : '');
    const [isRescheduled, setIsRescheduled] = useState(task ? task.isRescheduled || false : false);
    const [rescheduledEndDate, setRescheduledEndDate] = useState(task ? task.rescheduledEndDate || '' : '');

    useEffect(() => { if (!task) { setTaskColor(getProjectColor(projectId)); } }, [projectId, task, getProjectColor]);
    
    useEffect(() => {
        const effectiveEndDate = isRescheduled && rescheduledEndDate ? rescheduledEndDate : endDate;
        setDateWarning(checkDateWarning(effectiveEndDate));
    }, [endDate, rescheduledEndDate, isRescheduled]);

    const handleStartDateChange = (date) => { setStartDate(date); const newEndDate = new Date(date); newEndDate.setDate(newEndDate.getDate() + duration - 1); setEndDate(newEndDate.toISOString().split('T')[0]); };
    const handleDurationChange = (value) => { const newDur = parseInt(value, 10); if (newDur > 0) { setDuration(newDur); const newEndDate = new Date(startDate); newEndDate.setDate(newEndDate.getDate() + newDur - 1); setEndDate(newEndDate.toISOString().split('T')[0]); } };
    const handleEndDateChange = (date) => { setEndDate(date); const newDuration = calculateDaysDifference(startDate, date) + 1; if (newDuration > 0) { setDuration(newDuration); } };
    
    useEffect(() => {
        if (dependencies?.length > 0 && allTasks.length > 0) {
            const maxPredecessorEndDate = dependencies.reduce((latest, depId) => {
                const predecessor = allTasks.find(t => t.id === depId);
                if (!predecessor) return latest;
                const predecessorEndDate = predecessor.isRescheduled && predecessor.rescheduledEndDate ? new Date(predecessor.rescheduledEndDate) : new Date(predecessor.endDate);
                return predecessorEndDate > latest ? predecessorEndDate : latest;
            }, new Date(0));

            if (maxPredecessorEndDate > new Date(0)) {
                const currentEffectiveEndDate = isRescheduled && rescheduledEndDate ? new Date(rescheduledEndDate) : new Date(endDate);
                if (currentEffectiveEndDate < maxPredecessorEndDate) {
                    const newEndDate = new Date(maxPredecessorEndDate);
                    if(isRescheduled) {
                        setRescheduledEndDate(newEndDate.toISOString().split('T')[0]);
                    } else {
                        const newStartDate = new Date(newEndDate);
                        newStartDate.setDate(newEndDate.getDate() - (duration - 1));
                        setEndDate(newEndDate.toISOString().split('T')[0]);
                        setStartDate(newStartDate.toISOString().split('T')[0]);
                    }
                }
            }
        }
    }, [dependencies, allTasks, endDate, rescheduledEndDate, isRescheduled, duration]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!userId) return;

        const taskData = {
            name,
            startDate,
            endDate,
            completionPercentage: Number(completionPercentage),
            taskColor,
            assignedResources,
            dependencies,
            projectId,
            notes,
            isRescheduled,
            rescheduledEndDate: isRescheduled ? rescheduledEndDate : '',
        };

        try {
            if (task) {
                const taskRef = doc(db, `users/${userId}/tasks`, task.id);
                const updatePayload = { ...taskData };
                if (!task.originalStartDate && !task.originalEndDate) {
                    updatePayload.originalStartDate = task.startDate;
                    updatePayload.originalEndDate = task.endDate;
                }
                await updateDoc(taskRef, updatePayload);
            } else {
                await addDoc(collection(db, `users/${userId}/tasks`), {
                    ...taskData,
                    originalStartDate: startDate,
                    originalEndDate: endDate,
                    order: allTasks.filter(t => t.projectId === projectId).length
                });
            }
            onDone();
        } catch (error) {
            console.error("Errore salvataggio task:", error);
        }
    };

    const handleResourceToggle = (resourceId) => {
        setAssignedResources(prev => {
            const isAssigned = prev.some(ar => ar.resourceId === resourceId);
            if (isAssigned) {
                return prev.filter(ar => ar.resourceId !== resourceId);
            } else {
                return [...prev, { resourceId, allocation: 100 }];
            }
        });
    };

    const handleAllocationChange = (resourceId, allocation) => {
        const newAllocation = Math.max(0, Math.min(100, Number(allocation)));
        setAssignedResources(prev => 
            prev.map(ar => ar.resourceId === resourceId ? { ...ar, allocation: newAllocation } : ar)
        );
    };
    
    const handleDependencyToggle = (taskId) => setDependencies(prev => prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]);

    const availableTasksForDependency = useMemo(() => allTasks.filter(t => t.projectId === projectId && (!task || t.id !== task.id)), [allTasks, projectId, task]);
    
    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-sm font-medium text-gray-700">Progetto</label> <select value={projectId} onChange={e => setProjectId(e.target.value)} required disabled={!!task} className="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md disabled:bg-gray-100"> <option value="" disabled>-- Seleziona --</option> {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)} </select> </div> <div> <label className="block text-sm font-medium text-gray-700">Nome Attività</label> <input type="text" value={name} onChange={e => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md" /> </div> </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end"> <div> <label className="block text-sm font-medium">Data Inizio</label> <DatePicker value={startDate} onChange={handleStartDateChange} /> </div> <div> <label className="block text-sm font-medium">Data Fine (Originale)</label> <DatePicker value={endDate} onChange={handleEndDateChange} /> </div> </div>
            <div> <label className="block text-sm font-medium">Durata (giorni)</label> <div className="flex items-center gap-2"> <input type="range" min="1" max="365" value={duration} onChange={(e) => handleDurationChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" /> <input type="number" min="1" max="1000" value={duration} onChange={(e) => handleDurationChange(e.target.value)} className="w-24 px-2 py-1 bg-white border border-gray-300 rounded-md" /></div> </div>
            {dateWarning && <div className="p-2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 text-sm flex items-center gap-2"> <AlertTriangle size={16}/> {dateWarning}</div>}
            
            <div className="space-y-3">
                <label className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-50">
                    <input type="checkbox" checked={isRescheduled} onChange={(e) => { setIsRescheduled(e.target.checked); if (!e.target.checked) { setRescheduledEndDate(''); } else if (!rescheduledEndDate && endDate) { setRescheduledEndDate(endDate); } }} className="rounded text-blue-500 h-4 w-4"/>
                    <span className="font-medium text-gray-700">Attività Ripianificata</span>
                </label>
                {isRescheduled && (
                    <div className="p-3 bg-yellow-50 border rounded-md animate-fade-in">
                        <label className="block text-sm font-medium text-yellow-800">Nuova Data di Fine (Ripianificata)</label>
                        <DatePicker value={rescheduledEndDate} onChange={setRescheduledEndDate} required className="mt-1 block w-full px-3 py-2 bg-white border border-yellow-300 rounded-md shadow-sm"/>
                        <p className="text-xs text-yellow-600 mt-1">Questa data sostituirà la data di fine originale per dipendenze e report.</p>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                  <label className="block text-sm font-medium">Colore Attività</label>
                  <input type="color" value={taskColor} onChange={e => setTaskColor(e.target.value)} className="mt-1 w-full h-10 p-1 border border-gray-300 rounded-md"/>
              </div>
            </div>
            <div> <label className="block text-sm font-medium">Completamento: {completionPercentage}%</label> <div className="flex items-center gap-2"> <input type="range" min="0" max="100" value={completionPercentage} onChange={e => setCompletionPercentage(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" /> <input type="number" min="0" max="100" value={completionPercentage} onChange={e => setCompletionPercentage(e.target.value)} className="w-20 px-2 py-1 bg-white border border-gray-300 rounded-md" /> <button type="button" onClick={() => setCompletionPercentage(100)} className="bg-green-100 text-green-800 px-3 py-1 rounded-md text-sm hover:bg-green-200"><CheckCircle size={16}/></button></div> </div>
            <div> <label className="block text-sm font-medium text-gray-700">Note</label> <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows="3" className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm" placeholder="Aggiungi note sull'attività..." /> </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h4 className="text-sm font-medium mb-2">Risorse e Allocazione</h4>
                    <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2 bg-white">
                        {resources.map(res => {
                            const assignment = assignedResources.find(ar => ar.resourceId === res.id);
                            const isAssigned = !!assignment;
                            return (
                                <div key={res.id} className={`p-2 rounded-md ${isAssigned ? 'bg-blue-50' : ''}`}>
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center space-x-2 flex-grow">
                                            <input type="checkbox" checked={isAssigned} onChange={() => handleResourceToggle(res.id)} className="rounded text-blue-500" />
                                            <span>{res.name}</span>
                                        </label>
                                        {isAssigned && (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0" max="100"
                                                    value={assignment.allocation}
                                                    onChange={(e) => handleAllocationChange(res.id, e.target.value)}
                                                    className="w-20 px-2 py-1 text-sm bg-white border border-gray-300 rounded-md"
                                                />
                                                <Percent size={16} className="text-gray-500"/>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div>
                    <h4 className="text-sm font-medium mb-2">Predecessori</h4>
                    <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1 bg-white">
                        {availableTasksForDependency.length > 0 ? availableTasksForDependency.map(t => (
                            <div key={t.id}>
                                <label className="flex items-center space-x-2 p-1 rounded-md hover:bg-gray-100">
                                    <input type="checkbox" checked={dependencies?.includes(t.id)} onChange={() => handleDependencyToggle(t.id)} className="rounded text-blue-500" />
                                    <span>{t.name}</span>
                                </label>
                            </div>
                        )) : <p className="text-xs text-gray-500 p-2">Nessuna altra attività in questo progetto.</p>}
                    </div>
                </div>
            </div>
            <div className="flex justify-end pt-4"> <button type="button" onClick={onDone} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md mr-2">Annulla</button> <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md">Salva Attività</button> </div>
        </form>
    );
};


// --- VISTE REPORT ---
const ActivityReportView = ({ projectsWithData, onExportPDF }) => {
    const reportData = useMemo(() => {
        if (!projectsWithData) return { overdueTasks: [], dueTodayTasks: [], dueInThreeDaysTasks: [], otherTasks: [] };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(today.getDate() + 3);

        const allEnrichedTasks = projectsWithData.flatMap(project =>
            project.tasks.map(task => ({
                ...task,
                projectName: project.name || 'N/D',
                projectColor: project.color || '#cccccc',
            }))
        );

        const overdueTasks = []; const dueTodayTasks = []; const dueInThreeDaysTasks = []; const otherTasks = [];

        allEnrichedTasks.forEach(task => {
            const endDateToUse = task.effectiveEndDate || task.endDate; 
            const d = new Date(endDateToUse);
            d.setHours(0, 0, 0, 0);
            const isComplete = (task.completionPercentage || 0) >= 100;

            if (d < today && !isComplete) { overdueTasks.push(task);
            } else if (d.getTime() === today.getTime()) { dueTodayTasks.push(task);
            } else if (d > today && d <= threeDaysFromNow) { dueInThreeDaysTasks.push(task);
            } else { otherTasks.push(task); }
        });
        overdueTasks.sort((a, b) => new Date(a.effectiveEndDate || a.endDate) - new Date(b.effectiveEndDate || b.endDate));
        dueTodayTasks.sort((a, b) => a.projectName.localeCompare(b.projectName));
        dueInThreeDaysTasks.sort((a, b) => new Date(a.effectiveEndDate || a.endDate) - new Date(b.effectiveEndDate || b.endDate));
        otherTasks.sort((a, b) => new Date(a.effectiveEndDate || a.endDate) - new Date(b.effectiveEndDate || b.endDate));

        return { overdueTasks, dueTodayTasks, dueInThreeDaysTasks, otherTasks };
    }, [projectsWithData]);

    const renderTaskRow = (task) => ( <tr key={task.id}><td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900"><div className="flex items-center"><span className="w-3 h-3 rounded-full mr-3 flex-shrink-0" style={{backgroundColor: task.projectColor}}></span><span>{task.name}</span></div><div className="text-xs text-gray-500 pl-6">{task.projectName}</div></td><td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(task.effectiveEndDate || task.endDate).toLocaleDateString('it-IT')}</td><td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{task.assigned.map(r => r.details.name).join(', ') || 'N/A'}</td><td className="px-4 py-4 whitespace-nowrap text-sm text-center">{task.duration} gg</td><td className="px-4 py-4 whitespace-nowrap text-sm">{formatCurrency(task.totalEstimatedCost)}<br/><span className="text-xs text-gray-500">({formatCurrency(task.spentCost)})</span></td><td className="px-4 py-4 whitespace-nowrap"><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${task.completionPercentage || 0}%`}}></div></div><span className="text-xs text-gray-500">{task.completionPercentage || 0}%</span></td></tr> );

    return (
        <div className="p-4 md:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6"> <h2 className="text-2xl font-bold text-gray-800">Report Attività per Scadenza</h2> <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"> <FileDown size={16}/> Esporta PDF </button> </div>
            <div id="activity-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività / Progetto</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scadenza</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risorse</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Durata</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Stimato/Sostenuto</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avanzamento</th></tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {reportData.overdueTasks.length > 0 && <tr className="bg-red-200"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-red-800">SCADUTE E NON COMPLETATE</td></tr>}
                        {reportData.overdueTasks.map(renderTaskRow)}
                        {reportData.dueTodayTasks.length > 0 && <tr className="bg-red-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-red-800">IN SCADENZA OGGI</td></tr>}
                        {reportData.dueTodayTasks.map(renderTaskRow)}
                        {reportData.dueInThreeDaysTasks.length > 0 && <tr className="bg-yellow-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-yellow-800">IN SCADENZA A BREVE (3 GIORNI)</td></tr>}
                        {reportData.dueInThreeDaysTasks.map(renderTaskRow)}
                        {reportData.otherTasks.length > 0 && <tr className="bg-gray-100"><td colSpan="6" className="px-4 py-2 text-sm font-bold text-gray-700">ALTRE ATTIVITÀ</td></tr>}
                        {reportData.otherTasks.map(renderTaskRow)}
                        {reportData.overdueTasks.length === 0 && reportData.dueTodayTasks.length === 0 && reportData.dueInThreeDaysTasks.length === 0 && reportData.otherTasks.length === 0 && ( <tr><td colSpan="6" className="px-6 py-4 text-center text-sm text-gray-500">Nessuna attività da mostrare.</td></tr> )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AssignmentReportView = ({ projectsWithData, resources, onExportPDF }) => {
    const reportData = useMemo(() => {
        if (!projectsWithData || !resources) return [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const allTasks = projectsWithData.flatMap(p => p.tasks.map(t => ({...t, projectName: p.name, projectColor: p.color})));
        
        return resources.map(resource => {
            const assignedTasks = allTasks
                .filter(task => task.assigned?.some(a => a.resourceId === resource.id))
                .sort((a, b) => new Date(a.effectiveEndDate || a.endDate) - new Date(b.effectiveEndDate || b.endDate));
            
            let dailyWorkload = 0;
            const activeTasksToday = allTasks.filter(task => {
                const startDate = new Date(task.startDate);
                const endDate = new Date(task.effectiveEndDate || task.endDate); 
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(0, 0, 0, 0);
                return task.assigned?.some(a => a.resourceId === resource.id) && today >= startDate && today <= endDate;
            });
            
            activeTasksToday.forEach(task => {
                const assignment = task.assigned.find(a => a.resourceId === resource.id);
                if (assignment) {
                    dailyWorkload += (assignment.allocation || 100);
                }
            });

            return { ...resource, assignedTasks, dailyWorkload };
        }).sort((a, b) => a.name.localeCompare(b.name));
    }, [projectsWithData, resources]);

    return (
        <div className="p-4 md:p-6 lg:p-8">
             <div className="flex justify-between items-center mb-6"> <h2 className="text-2xl font-bold text-gray-800">Report Assegnazioni Risorse</h2> <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"> <FileDown size={16}/> Esporta PDF </button> </div>
            <div id="assignment-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                 {reportData.map(resource => (
                    <div key={resource.id} className="mb-8">
                        <div className={`p-3 border-b-2 ${resource.dailyWorkload > 100 ? 'bg-red-100 border-red-300' : 'bg-gray-100 border-gray-300'}`}>
                            <h3 className="text-lg font-bold text-gray-800">{resource.name}</h3>
                            <p className="text-sm text-gray-600">
                                Carico di lavoro odierno stimato: 
                                <span className={`font-bold ${resource.dailyWorkload > 100 ? 'text-red-600' : 'text-gray-800'}`}> {resource.dailyWorkload.toFixed(0)}%</span>
                            </p>
                        </div>
                        <table className="min-w-full">
                            <thead className="bg-gray-50"><tr><th className="w-1/3 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività</th><th className="w-1/3 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progetto</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scadenza</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avanzamento</th></tr></thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {resource.assignedTasks.length > 0 ? resource.assignedTasks.map(task => ( <tr key={task.id}> <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{task.name}</td> <td className="px-4 py-4 whitespace-nowrap text-sm"><div className="flex items-center"><span className="w-3 h-3 rounded-full mr-2" style={{backgroundColor: task.projectColor}}></span>{task.projectName}</div></td> <td className="px-4 py-4 whitespace-nowrap text-sm">{new Date(task.effectiveEndDate || task.endDate).toLocaleDateString('it-IT')}</td> <td className="px-4 py-4 whitespace-nowrap"><div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${task.completionPercentage || 0}%`}}></div></div><span className="text-xs text-gray-500">{task.completionPercentage || 0}%</span></td> </tr>
                                )) : ( <tr><td colSpan="4" className="px-4 py-4 text-sm text-gray-500 italic">Nessuna attività assegnata.</td></tr> )}
                            </tbody>
                        </table>
                    </div>
                   ))}
            </div>
        </div>
    );
};

const CostReportView = ({ projectsWithData, onExportPDF }) => {
    const { projects, grandTotalCost, grandSpentCost, grandTotalBudget } = useMemo(() => {
        if (!projectsWithData) {
            return { projects: [], grandTotalCost: 0, grandSpentCost: 0, grandTotalBudget: 0 };
        }

        let grandTotalCost = 0;
        let grandSpentCost = 0;
        let grandTotalBudget = 0;
        
        projectsWithData.forEach(p => {
            grandTotalCost += p.projectTotalCost + (p.extraCosts || 0);
            grandSpentCost += p.projectSpentCost + (p.extraCosts || 0);
            grandTotalBudget += p.budget || 0;
        });

        return { projects: projectsWithData, grandTotalCost, grandSpentCost, grandTotalBudget };
    }, [projectsWithData]);

    return (
        <div className="p-4 md:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Report Costi</h2>
                <button onClick={onExportPDF} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2">
                    <FileDown size={16} /> Esporta PDF
                </button>
            </div>
            <div id="cost-report-content" className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attività</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risorse</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Stimato</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Costo Sostenuto</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {projects.flatMap(project => {
                            const projectTextColor = getContrastingTextColor(project.color);
                            return [
                                <tr key={project.id} style={{ backgroundColor: project.color }}>
                                    <td colSpan="4" className={`px-6 py-3 text-sm font-bold ${projectTextColor}`}>
                                        <div className="flex justify-between items-center">
                                            <span>{project.name}</span>
                                            <div className="text-right">
                                                <span className="font-normal">Compl: {project.projectCompletionPercentage?.toFixed(1) || '0.0'}%</span>
                                                {project.budget > 0 && (
                                                    <div className="mt-1 text-xs">
                                                        <span className="font-normal">Budget: {formatCurrency(project.budget)}</span>
                                                        <br/>
                                                        <span className={`${project.budgetUsagePercentage > 100 ? 'font-extrabold' : 'font-normal'}`} style={{color: project.budgetUsagePercentage > 100 ? '#dc2626' : projectTextColor }}>
                                                            Utilizzo: {project.budgetUsagePercentage.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                </tr>,
                                ...(project.tasks.length > 0 ? project.tasks.map(task => (
                                    <tr key={task.id}>
                                        <td className="px-6 py-4 whitespace-nowrap"><p className="text-sm font-medium text-gray-900">{task.name}</p><p className="text-sm text-gray-500">{task.completionPercentage || 0}% completato</p></td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.assigned.map(r => `${r.details.name} (${r.allocation}%)`).join(', ') || 'N/A'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">{formatCurrency(task.totalEstimatedCost)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">{formatCurrency(task.spentCost)}</td>
                                    </tr>
                                )) : [
                                    <tr key={`${project.id}-empty`}><td colSpan="4" className="px-6 py-4 text-sm text-gray-500 italic">Nessuna attività.</td></tr>
                                ]),
                                (project.extraCosts > 0 &&
                                    <tr key={`${project.id}-extra`}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 italic" colSpan="2">Altre Spese</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">{formatCurrency(project.extraCosts)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">{formatCurrency(project.extraCosts)}</td>
                                    </tr>
                                ),
                                <tr key={`${project.id}-total`} className="bg-gray-50">
                                    <td colSpan="2" className="px-6 py-2 text-sm font-semibold text-right">
                                        Totale Progetto
                                        {project.budget > 0 && 
                                            <div className="text-xs font-normal text-gray-600">
                                                (Budget: {formatCurrency(project.budget)})
                                            </div>
                                        }
                                    </td>
                                    <td className="px-6 py-2 text-right text-sm font-semibold">{formatCurrency(project.projectTotalCost + (project.extraCosts || 0))}</td>
                                    <td className="px-6 py-2 text-right text-sm font-semibold">{formatCurrency(project.projectSpentCost + (project.extraCosts || 0))}</td>
                                </tr>
                            ];
                        })}
                    </tbody>
                    <tfoot className="bg-gray-200">
                        <tr>
                            <td colSpan="2" className="px-6 py-4 text-base font-bold text-right">
                                TOTALE GENERALE
                                {grandTotalBudget > 0 && 
                                    <div className="text-sm font-normal">
                                        (Budget Totale: {formatCurrency(grandTotalBudget)})
                                    </div>
                                }
                            </td>
                            <td className="px-6 py-4 text-right text-base font-bold">{formatCurrency(grandTotalCost)}</td>
                            <td className="px-6 py-4 text-right text-base font-bold">{formatCurrency(grandSpentCost)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};


// --- VISTA MASTER ---
const MainDashboard = ({ projects, tasks, resources, db, userId, auth }) => {
    const [view, setView] = useState('gantt'); const [isLoading, setIsLoading] = useState(false); const [loadingMessage, setLoadingMessage] = useState(''); const [notification, setNotification] = useState({ message: '', type: 'info' }); const [isTaskModalOpen, setIsTaskModalOpen] = useState(false); const [isResourceModalOpen, setIsResourceModalOpen] = useState(false); const [isProjectModalOpen, setIsProjectModalOpen] = useState(false); const [editingTask, setEditingTask] = useState(null); const [editingProject, setEditingProject] = useState(null); const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false); const [importFile, setImportFile] = useState(null); const [selectedProjectId, setSelectedProjectId] = useState(null); const dragInfo = useRef({}); const fileInputRef = useRef(null);
    const [itemToDelete, setItemToDelete] = useState(null);
    const ganttContainerRef = useRef(null);
    const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
    
    const ROW_HEIGHT = 64; const DAY_WIDTH = 40; const PROJECT_HEADER_HEIGHT = 64; const SIDEBAR_WIDTH = 384;

    const { overallStartDate, totalDays } = useMemo(() => { 
        if (tasks.length === 0) return { overallStartDate: new Date(), totalDays: 30 };
        const allDates = tasks.flatMap(t => [new Date(t.startDate), new Date(t.endDate), t.isRescheduled && t.rescheduledEndDate ? new Date(t.rescheduledEndDate) : null]).filter(d => d && !isNaN(d));
        if (allDates.length === 0) return { overallStartDate: new Date(), totalDays: 30 };
        
        const minDate = new Date(Math.min(...allDates)); 
        const maxDate = new Date(Math.max(...allDates)); 
        if (isNaN(minDate) || isNaN(maxDate)) return { overallStartDate: new Date(), totalDays: 30 };
        const diff = calculateDaysDifference(minDate, maxDate) + 5; 
        return { overallStartDate: minDate, totalDays: diff > 30 ? diff : 30 };
    }, [tasks]);

    const dateHeaders = useMemo(() => { const headers = []; let currentDate = new Date(overallStartDate); currentDate.setDate(currentDate.getDate() - 1); for (let i = 0; i < totalDays + 2; i++) { headers.push(new Date(currentDate)); currentDate.setDate(currentDate.getDate() + 1); } return headers; }, [overallStartDate, totalDays]);
    
    const { projectsWithData, taskPositions, ganttHeight } = useMemo(() => {
        if (!projects || !tasks || !resources || dateHeaders.length === 0) return { projectsWithData: [], taskPositions: new Map(), ganttHeight: 0 };
        
        const taskMap = {};
        tasks.forEach(task => {
            const startDate = new Date(task.startDate);
            const endDate = new Date(task.endDate);
            const rescheduledEndDate = (task.isRescheduled && task.rescheduledEndDate) ? new Date(task.rescheduledEndDate) : null;
            const effectiveEndDate = rescheduledEndDate || endDate;
            const duration = calculateDaysDifference(startDate, effectiveEndDate) + 1;
            taskMap[task.id] = { ...task, startDate, endDate, rescheduledEndDate, effectiveEndDate, duration: duration > 0 ? duration : 1 };
        });

        for (let i = 0; i < tasks.length * 2; i++) {
            tasks.forEach(task => {
                if (task.dependencies && task.dependencies.length > 0) {
                    let maxPredecessorEndDate = new Date(0);
                    task.dependencies.forEach(depId => {
                        const predecessor = taskMap[depId];
                        if (predecessor && predecessor.effectiveEndDate > maxPredecessorEndDate) {
                            maxPredecessorEndDate = predecessor.effectiveEndDate;
                        }
                    });

                    if (maxPredecessorEndDate > new Date(0)) {
                        const successorTask = taskMap[task.id];
                        if (successorTask.effectiveEndDate < maxPredecessorEndDate) {
                            const duration = successorTask.duration;
                            const newEndDate = new Date(maxPredecessorEndDate);
                            const newStartDate = new Date(newEndDate);
                            newStartDate.setDate(newEndDate.getDate() - duration + 1);
                            taskMap[task.id].startDate = newStartDate;
                            taskMap[task.id].effectiveEndDate = newEndDate;
                        }
                    }
                }
            });
        }
        
        const processedTasks = Object.values(taskMap);
        const positions = new Map();
        let currentY = 0;

        const pWithData = projects.sort((a,b) => a.name.localeCompare(b.name)).map(p => { 
            const projectTasks = processedTasks.filter(t => t.projectId === p.id).sort((a,b) => (a.order || 0) - (b.order || 0));
            let totalDuration = 0; let weightedCompletion = 0; let projectTotalCost = 0; let projectSpentCost = 0;
            const projectTop = currentY;
            currentY += PROJECT_HEADER_HEIGHT;

            const enrichedTasks = projectTasks.map(task => {
                const duration = task.duration;
                const completion = task.completionPercentage || 0;
                
                const assigned = (task.assignedResources || []).map(assignment => {
                    const details = resources.find(r => r.id === assignment.resourceId);
                    return { ...assignment, details: details || { name: 'N/A', hourlyCost: 0 } };
                }).filter(Boolean);

                let totalEstimatedCost = 0;
                assigned.forEach(a => {
                    const dailyCost = (a.details.hourlyCost || 0) * 8;
                    totalEstimatedCost += dailyCost * (a.allocation / 100) * duration;
                });
                
                const spentCost = totalEstimatedCost * (completion / 100);

                totalDuration += duration;
                weightedCompletion += duration * completion;
                projectTotalCost += totalEstimatedCost;
                projectSpentCost += spentCost;

                const pos = {
                    top: currentY,
                    left: calculateDaysDifference(dateHeaders[0], task.startDate) * DAY_WIDTH,
                    width: (duration > 0 ? duration : 1) * DAY_WIDTH,
                };
                
                if (task.originalStartDate && task.originalEndDate) {
                    const originalStartDateForCalc = new Date(task.originalStartDate);
                    const originalEndDateForCalc = new Date(task.originalEndDate);
                    const originalDuration = calculateDaysDifference(originalStartDateForCalc, originalEndDateForCalc) + 1;
                    
                    pos.originalLeft = calculateDaysDifference(dateHeaders[0], originalStartDateForCalc) * DAY_WIDTH;
                    pos.originalWidth = (originalDuration > 0 ? originalDuration : 1) * DAY_WIDTH;
                }

                positions.set(task.id, pos);
                
                currentY += ROW_HEIGHT;
                return {...task, assigned, duration, totalEstimatedCost, spentCost };
            });
            
            if (projectTasks.length === 0) { currentY += ROW_HEIGHT; }
            
            const projectCompletionPercentage = totalDuration > 0 ? weightedCompletion / totalDuration : 0;
            const budget = p.budget || 0;
            const extraCosts = p.extraCosts || 0;
            const totalEstimatedCostWithExtras = projectTotalCost + extraCosts;
            const budgetUsagePercentage = budget > 0 ? (totalEstimatedCostWithExtras / budget) * 100 : 0;

            return { ...p, tasks: enrichedTasks, projectCompletionPercentage, projectTotalCost, projectSpentCost, budget, extraCosts, budgetUsagePercentage, projectTop };
        }); 
        return { projectsWithData: pWithData, taskPositions: positions, ganttHeight: currentY };
    }, [tasks, projects, resources, dateHeaders, DAY_WIDTH, ROW_HEIGHT, PROJECT_HEADER_HEIGHT]);

    const arrowPaths = useMemo(() => {
        const paths = [];
        if (!tasks || taskPositions.size === 0) return paths;
        tasks.forEach(task => {
            if (task.dependencies && task.dependencies.length > 0) {
                const successorPos = taskPositions.get(task.id);
                if (!successorPos) return;
                task.dependencies.forEach(predecessorId => {
                    const predecessorPos = taskPositions.get(predecessorId);
                    if (!predecessorPos) return;
                    const startX = predecessorPos.left + predecessorPos.width; const startY = predecessorPos.top + (ROW_HEIGHT / 2);
                    const endX = successorPos.left; const endY = successorPos.top + (ROW_HEIGHT / 2);
                    const path = `M ${startX} ${startY} L ${startX + DAY_WIDTH / 2} ${startY} L ${startX + DAY_WIDTH / 2} ${endY} L ${endX} ${endY}`;
                    paths.push({id: `${predecessorId}-${task.id}`, d: path});
                });
            }
        });
        return paths;
    }, [tasks, taskPositions, DAY_WIDTH, ROW_HEIGHT]);

    const handleEditTask = (task) => { setEditingTask(tasks.find(t=>t.id === task.id)); setIsTaskModalOpen(true); };
    const handleEditProject = (project) => { setEditingProject(project); setIsProjectModalOpen(true); };
    const handleOpenNewProjectModal = () => { const existingColors = projects.map(p => p.color); let newColor; do { newColor = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`; } while (existingColors.includes(newColor)); setEditingProject({ name: '', color: newColor }); setIsProjectModalOpen(true); };
    const confirmDeleteItem = (item, type) => setItemToDelete({item, type});
    
    const handleDeleteItem = async () => {
        if (!itemToDelete || !userId) return;
        const { item, type } = itemToDelete;
        setIsLoading(true); setLoadingMessage("Cancellazione...");
        try {
            const batch = writeBatch(db);
            if (type === 'task') {
                const tasksToUpdate = tasks.filter(t => t.dependencies?.includes(item.id));
                tasksToUpdate.forEach(t => { const taskRef = doc(db, `users/${userId}/tasks`, t.id); batch.update(taskRef, { dependencies: t.dependencies.filter(depId => depId !== item.id) }); });
                const taskRef = doc(db, `users/${userId}/tasks`, item.id); batch.delete(taskRef);
                setNotification({message: "Attività eliminata.", type: "success"});
            } else if (type === 'project') {
                const tasksQuery = query(collection(db, `users/${userId}/tasks`), where("projectId", "==", item.id));
                const tasksSnapshot = await getDocs(tasksQuery);
                tasksSnapshot.forEach(d => batch.delete(d.ref));
                const projectRef = doc(db, `users/${userId}/projects`, item.id); batch.delete(projectRef);
                setNotification({message: "Progetto e attività eliminate.", type: "success"});
            }
            await batch.commit();
        } catch (error) { console.error("Errore eliminazione:", error); setNotification({message: `Errore: ${error.message}`, type: "error"});
        } finally { setItemToDelete(null); setIsLoading(false); }
    };
    
    const handleGanttDrop = async (e) => { e.preventDefault(); if (!userId) return; const { taskId, type, initialX, initialStartDate, initialEndDate, isRescheduled, initialRescheduledEndDate } = dragInfo.current; if (!taskId) return; const dateOffset = Math.round((e.clientX - initialX) / DAY_WIDTH); let newStartDate, newEndDate, newRescheduledEndDate; const taskRef = doc(db, `users/${userId}/tasks`, taskId); let updateData = {}; if (type === 'move') { const duration = calculateDaysDifference(initialStartDate, isRescheduled ? initialRescheduledEndDate : initialEndDate); newStartDate = new Date(initialStartDate); newStartDate.setDate(newStartDate.getDate() + dateOffset); if (isRescheduled) { newRescheduledEndDate = new Date(newStartDate); newRescheduledEndDate.setDate(newRescheduledEndDate.getDate() + duration); updateData = { startDate: newStartDate.toISOString().split('T')[0], rescheduledEndDate: newRescheduledEndDate.toISOString().split('T')[0] }; } else { newEndDate = new Date(newStartDate); newEndDate.setDate(newEndDate.getDate() + duration); updateData = { startDate: newStartDate.toISOString().split('T')[0], endDate: newEndDate.toISOString().split('T')[0] }; } } else if (type === 'resize-end') { if (isRescheduled) { newRescheduledEndDate = new Date(initialRescheduledEndDate); newRescheduledEndDate.setDate(newRescheduledEndDate.getDate() + dateOffset); if (newRescheduledEndDate < new Date(initialStartDate)) newRescheduledEndDate = new Date(initialStartDate); updateData = { rescheduledEndDate: newRescheduledEndDate.toISOString().split('T')[0] }; } else { newEndDate = new Date(initialEndDate); newEndDate.setDate(newEndDate.getDate() + dateOffset); if (newEndDate < new Date(initialStartDate)) newEndDate = new Date(initialStartDate); updateData = { endDate: newEndDate.toISOString().split('T')[0] }; } } else if (type === 'resize-start') { newStartDate = new Date(initialStartDate); newStartDate.setDate(newStartDate.getDate() + dateOffset); const effectiveEndDate = isRescheduled ? new Date(initialRescheduledEndDate) : new Date(initialEndDate); if (newStartDate > effectiveEndDate) newStartDate = effectiveEndDate; updateData = { startDate: newStartDate.toISOString().split('T')[0] }; } else { return; } try { await updateDoc(taskRef, updateData); } catch(error) { console.error("Errore aggiornamento task:", error); } dragInfo.current = {}; };
    const handleDragStart = (e, task, type) => { e.dataTransfer.effectAllowed = 'move'; dragInfo.current = { taskId: task.id, type, initialX: e.clientX, initialStartDate: task.startDate, initialEndDate: task.endDate, isRescheduled: task.isRescheduled, initialRescheduledEndDate: task.rescheduledEndDate }; };

    const exportData = () => { const dataToExport = { projects, tasks, resources, exportedAt: new Date().toISOString() }; const dataStr = JSON.stringify(dataToExport, null, 2); const blob = new Blob([dataStr], {type: "application/json"}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `gantt_backup_${new Date().toISOString().split('T')[0]}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); setNotification({message: "Esportazione completata.", type: "success"}); };
    const handleFileImportChange = (e) => { const file = e.target.files[0]; if (file) { setImportFile(file); setIsImportConfirmOpen(true); } e.target.value = null; };
    
    const importData = async () => { if (!importFile || !userId) return; setIsLoading(true); setLoadingMessage("Importazione in corso..."); const reader = new FileReader(); reader.onload = async (e) => { try { const data = JSON.parse(e.target.result); if (!data.projects || !data.tasks || !data.resources) { throw new Error("Formato file non valido."); } setLoadingMessage("Cancellazione dati esistenti..."); const collectionsToDelete = ['tasks', 'resources', 'projects']; for (const coll of collectionsToDelete) { const userCollRef = collection(db, `users/${userId}/${coll}`); const snapshot = await getDocs(userCollRef); const batch = writeBatch(db); snapshot.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); } setLoadingMessage("Importazione nuovi dati..."); const importBatch = writeBatch(db); data.projects.forEach(p => {const {id, ...rest} = p; importBatch.set(doc(collection(db, `users/${userId}/projects`)), rest)}); data.tasks.forEach(t => {const {id, ...rest} = t; importBatch.set(doc(collection(db, `users/${userId}/tasks`)), rest)}); data.resources.forEach(r => {const {id, ...rest} = r; importBatch.set(doc(collection(db, `users/${userId}/resources`)), rest)}); await importBatch.commit(); setNotification({message: "Importazione completata!", type: "success"}); } catch (error) { console.error("Errore importazione:", error); setNotification({message: `Errore importazione: ${error.message}`, type: "error"}); } finally { setIsLoading(false); setImportFile(null); setIsImportConfirmOpen(false); } }; reader.readAsText(importFile); };
    
    const exportToPDF = (reportType) => {
        const { jsPDF } = window.jspdf;
        if (typeof jsPDF === 'undefined' || (reportType === 'gantt' && typeof window.html2canvas === 'undefined')) {
            setNotification({ message: "Libreria PDF non caricata. Riprova.", type: "error" });
            return;
        }

        setIsLoading(true);
        setLoadingMessage(`Generazione anteprima ${reportType}...`);

        if (reportType === 'gantt') {
            const ganttElement = ganttContainerRef.current;
            const contentToCapture = ganttElement.firstChild;

            if (!contentToCapture) {
                setNotification({ message: "Impossibile trovare il contenuto del Gantt da esportare.", type: 'error' });
                setIsLoading(false);
                return;
            }

            window.html2canvas(contentToCapture, { 
                backgroundColor: '#ffffff',
                useCORS: true, 
                scale: 1.5,
            })
            .then(canvas => {
                const imgData = canvas.toDataURL('image/png');
                const doc = new jsPDF('l', 'mm', 'a4');
                const imgWidth = 280; 
                const pageHeight = 190;
                const imgHeight = canvas.height * imgWidth / canvas.width;
                let heightLeft = imgHeight; 
                let position = 10;
                doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
                while (heightLeft > 0) {
                    position = heightLeft - imgHeight + 10;
                    doc.addPage();
                    doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }
                doc.output('dataurlnewwindow');
            })
            .catch((err) => {
                 console.error("Gantt export error:", err);
                 setNotification({ message: "Errore durante l'esportazione del Gantt.", type: 'error' });
            })
            .finally(() => {
                 setIsLoading(false);
            });
            return;
        }
        
        const convertToHex = (col) => {
            if (col.startsWith('#')) return col;
            if (!col || !col.startsWith('rgb') || col === 'rgba(0, 0, 0, 0)') return '#FFFFFF';
            try {
                const rgb = col.replace(/[^\d,]/g, '').split(',');
                const r = parseInt(rgb[0], 10).toString(16).padStart(2, '0');
                const g = parseInt(rgb[1], 10).toString(16).padStart(2, '0');
                const b = parseInt(rgb[2], 10).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            } catch (e) {
                return '#FFFFFF';
            }
        };

        const commonAutoTableOptions = {
            didParseCell: function(data) {
                const raw = data.cell.raw;
                if (raw && (raw.nodeName === 'TD' || raw.nodeName === 'TH')) {
                    const computedStyle = window.getComputedStyle(raw);
                    let bgColor = computedStyle.backgroundColor;
                    if (bgColor === 'rgba(0, 0, 0, 0)') {
                        bgColor = '#FFFFFF';
                    }
                    data.cell.styles.fillColor = bgColor;
                    
                    const hexColor = convertToHex(bgColor);
                    const contrastingColor = getContrastingTextColor(hexColor);
                    
                    data.cell.styles.textColor = computedStyle.color || contrastingColor;
                    data.cell.styles.halign = raw.style.textAlign || 'left';
                }
            }
        };

        const doc = new jsPDF();
        try {
            if (reportType === 'cost' || reportType === 'activity') {
                const title = reportType === 'cost' ? 'Report Costi' : 'Report Attività';
                doc.text(title, 14, 15);
                doc.autoTable({
                    html: `#${reportType}-report-content table`,
                    startY: 20,
                    ...commonAutoTableOptions
                });
            } else if (reportType === 'assignment') {
                const content = document.getElementById('assignment-report-content');
                doc.text('Report Assegnazioni', 14, 15);
                let startY = 20;
                const resourceDivs = content.querySelectorAll(':scope > div');
                resourceDivs.forEach((div) => {
                    const h3 = div.querySelector('h3');
                    const p = div.querySelector('p');
                    const table = div.querySelector('table');
                    if (startY > 250) {
                       doc.addPage();
                       startY = 15;
                    }
                    if (h3) { doc.setFontSize(12).setFont(undefined, 'bold'); doc.text(h3.innerText, 14, startY); startY += 6; }
                    if (p) { doc.setFontSize(10).setFont(undefined, 'normal'); doc.text(p.innerText, 14, startY); startY += 4; }
                    if (table) {
                        doc.autoTable({ html: table, startY: startY, ...commonAutoTableOptions });
                        startY = doc.autoTable.previous.finalY + 10;
                    }
                });
            }
            doc.output('dataurlnewwindow');
        } catch (e) {
            console.error("PDF export error:", e);
            setNotification({ message: `Errore durante la creazione del PDF: ${e.message}`, type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleShowTooltip = (e, content) => { if (!content || content.trim() === '') return; setTooltip({ visible: true, content, x: e.clientX + 10, y: e.clientY + 10 }); };
    const handleMoveTooltip = (e) => { if (tooltip.visible) { setTooltip(prev => ({ ...prev, x: e.clientX + 10, y: e.clientY + 10 })); }};
    const handleHideTooltip = () => { setTooltip(prev => ({ ...prev, visible: false })); };

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Errore durante il logout:", error);
            setNotification({message: `Errore logout: ${error.message}`, type: "error"});
        }
    };

    const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
    const todayMarkerPosition = useMemo(() => { if (dateHeaders.length === 0) return -1; return calculateDaysDifference(dateHeaders[0], today) * DAY_WIDTH; }, [dateHeaders, today]);

    return (
        <div className="h-screen w-screen bg-gray-100 flex flex-col font-sans">
            {isLoading && <Loader message={loadingMessage} />}
            <Notification message={notification.message} type={notification.type} onClose={() => setNotification({message: ''})} />
            {tooltip.visible && <div className="fixed bg-gray-800 text-white text-sm rounded-md px-3 py-2 z-50 pointer-events-none max-w-xs whitespace-pre-wrap shadow-lg" style={{ top: `${tooltip.y}px`, left: `${tooltip.x}px` }}>{tooltip.content}</div>}
            <header className="p-4 border-b flex items-center justify-between bg-white shadow-sm flex-wrap gap-2">
                <div className="flex items-center gap-4"> <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1> <div className="flex items-center gap-1 rounded-lg bg-gray-200 p-1"> <button onClick={() => setView('gantt')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='gantt' ? 'bg-white shadow' : 'text-gray-600'}`}><LayoutDashboard size={16}/> Gantt</button> <button onClick={() => setView('assignmentReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='assignmentReport' ? 'bg-white shadow' : 'text-gray-600'}`}><ClipboardList size={16}/> Assegnazioni</button> <button onClick={() => setView('activityReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='activityReport' ? 'bg-white shadow' : 'text-gray-600'}`}><BarChart3 size={16}/> Attività</button> <button onClick={() => setView('costReport')} className={`px-2 py-1 text-sm font-medium rounded-md flex items-center gap-1 ${view==='costReport' ? 'bg-white shadow' : 'text-gray-600'}`}><BarChart3 size={16}/> Costi</button> </div> </div>
                <div className="flex items-center gap-2 flex-wrap"> <button onClick={exportData} className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 flex items-center gap-2 text-sm"><FileDown size={16}/> Esporta Dati</button> <button onClick={() => fileInputRef.current.click()} className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 flex items-center gap-2 text-sm"><FileUp size={16}/> Importa Dati</button> <input type="file" ref={fileInputRef} onChange={handleFileImportChange} accept=".json" className="hidden"/> <button onClick={handleOpenNewProjectModal} className="bg-purple-600 text-white px-3 py-2 rounded-md hover:bg-purple-700 flex items-center gap-2 text-sm"> <Plus size={16} /> Progetto </button> <button onClick={() => setIsResourceModalOpen(true)} className="bg-yellow-500 text-white px-3 py-2 rounded-md hover:bg-yellow-600 flex items-center gap-2 text-sm"> <Users size={16} /> Risorse </button> <button onClick={() => { setEditingTask(null); setIsTaskModalOpen(true); }} className="bg-blue-500 text-white px-3 py-2 rounded-md hover:bg-blue-600 flex items-center gap-2 text-sm"> <Plus size={16} /> Attività </button> <button onClick={handleLogout} className="bg-red-500 text-white px-3 py-2 rounded-md hover:bg-red-600 flex items-center gap-2 text-sm"> <LogOut size={16} /> Logout </button> </div>
            </header>
            <main className="flex-grow overflow-auto">
                {view === 'gantt' ? (
                    <div className="h-full w-full overflow-auto" ref={ganttContainerRef} onDrop={handleGanttDrop} onDragOver={e => e.preventDefault()}>
                        <div className="grid" style={{ gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr`, width: `${SIDEBAR_WIDTH + dateHeaders.length * DAY_WIDTH}px` }}>
                            {/* Colonna Sinistra (Sidebar) */}
                            <div className="sticky left-0 z-20 bg-gray-50">
                                <div className="sticky top-0 z-10 flex items-center justify-between h-12 px-4 border-b border-r bg-gray-100"><span className="font-semibold text-gray-700">Progetti</span><button onClick={() => exportToPDF('gantt')} className="text-blue-600 hover:text-blue-800 p-1"><FileDown size={18}/></button></div>
                                {projectsWithData.map(project => (
                                    <div key={project.id} className="group/project">
                                        <div onClick={() => setSelectedProjectId(project.id)} className={`flex items-center justify-between p-2 px-4 cursor-pointer transition-all border-b border-r ${selectedProjectId === project.id ? 'bg-blue-200 border-l-4 border-blue-600' : 'bg-white'}`} style={{height: `${PROJECT_HEADER_HEIGHT}px`}}>
                                            <div className="flex items-center gap-3 flex-grow overflow-hidden"><span className="w-4 h-4 rounded-full flex-shrink-0" style={{backgroundColor: project.color}}></span> <div className="flex-grow overflow-hidden"><h3 className="font-bold text-gray-800 truncate">{project.name}</h3> <div className="w-full bg-gray-300 rounded-full h-1.5 mt-1"><div className="bg-green-500 h-1.5 rounded-full" style={{width: `${project.projectCompletionPercentage.toFixed(0)}%`}}></div></div><span className="text-xs text-gray-500">Compl: {project.projectCompletionPercentage.toFixed(1)}%</span> {project.budget > 0 && (<span className={`text-xs ml-2 ${project.budgetUsagePercentage > 100 ? 'text-red-600 font-bold' : 'text-gray-500'}`}>Budget: {project.budgetUsagePercentage.toFixed(1)}%</span>)}</div></div><div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover/project:opacity-100 transition-opacity"><button onClick={(e) => {e.stopPropagation(); handleEditProject(project)}} className="p-1 text-gray-500 hover:text-blue-600"><Edit size={16}/></button><button onClick={(e) => {e.stopPropagation(); confirmDeleteItem(project, 'project')}} className="p-1 text-gray-500 hover:text-red-600"><Trash2 size={16}/></button></div>
                                        </div>
                                        {project.tasks.map(task => (
                                            <div key={task.id} className="flex items-center group/task p-2 pl-9 border-b border-r bg-gray-50" style={{height: `${ROW_HEIGHT}px`}} onDoubleClick={() => handleEditTask(task)}>
                                                <div className="flex-grow overflow-hidden"><p className="font-medium text-gray-900 truncate">{task.name}</p><div className="flex flex-wrap gap-1 mt-1">{task.assigned?.map(r => <span key={r.details.id} className="text-xs bg-gray-200 text-gray-800 px-1.5 py-0.5 rounded-full">{r.details.name} ({r.allocation}%)</span>)}</div></div>
                                                <div className="flex items-center opacity-0 group-hover/task:opacity-100 transition-opacity"><button onClick={(e) => {e.stopPropagation(); handleEditTask(task)}} className="p-1 text-gray-500 hover:text-blue-600"><Edit size={16}/></button><button onClick={(e) => {e.stopPropagation(); confirmDeleteItem(task, 'task')}} className="p-1 text-gray-500 hover:text-red-600"><Trash2 size={16}/></button></div>
                                            </div>
                                        ))} 
                                        {project.tasks.length === 0 && <div className="pl-9 text-xs text-gray-500 italic h-full flex items-center border-b border-r" style={{height: `${ROW_HEIGHT}px`}}>Nessuna attività.</div>}
                                    </div>
                                ))}
                            </div>
                            {/* Colonna Destra (Timeline) */}
                            <div className="relative">
                                <div className="sticky top-0 z-10 flex h-12 bg-white border-b">{dateHeaders.map((date) => { const isToday = date.toDateString() === today.toDateString(); return (<div key={date.toISOString()} className={`w-10 text-center border-r flex-shrink-0 flex flex-col justify-center ${isToday ? 'bg-red-200' : 'bg-gray-50'}`}><div className={`text-xs ${date.getDay() === 0 || date.getDay() === 6 ? 'text-red-500' : 'text-gray-500'}`}>{['D', 'L', 'M', 'M', 'G', 'V', 'S'][date.getDay()]}</div><div className={`text-sm font-semibold ${isToday ? 'text-red-600' : 'text-gray-800'}`}>{date.getDate()}</div></div>)})}</div>
                                <div className="relative" style={{height: `${ganttHeight}px`}}>
                                    <div className="absolute top-0 left-0 h-full w-0.5 bg-red-500 opacity-75 z-20" style={{ transform: `translateX(${todayMarkerPosition}px)`}}></div>
                                    {projectsWithData.map(project => project.tasks.map(task => { 
                                        const pos = taskPositions.get(task.id); 
                                        if(!pos) return null; 
                                        
                                        const isPlaceholderVisible = task.isRescheduled && typeof pos.originalLeft === 'number';

                                        return (
                                            <div key={task.id} className="absolute" style={{ top: `${pos.top}px`, height: `${ROW_HEIGHT}px`, left: '0px', width: '100%', pointerEvents: 'none' }}>

                                                {/* Main task bar */}
                                                <div className="absolute flex items-center" style={{ top: `0px`, height: `${ROW_HEIGHT}px`, left: `${pos.left}px`, width: `${pos.width}px`, pointerEvents: 'auto', zIndex: 10 }}>
                                                    <div draggable onDragStart={(e) => handleDragStart(e, task, 'move')} onDoubleClick={() => handleEditTask(task)} onMouseEnter={(e) => handleShowTooltip(e, task.notes)} onMouseMove={handleMoveTooltip} onMouseLeave={handleHideTooltip} className={`h-8 rounded-md shadow-sm flex items-center w-full group relative cursor-move box-border ${task.isRescheduled ? 'border-2 border-yellow-500' : ''}`} style={{ backgroundColor: task.taskColor || project.color || '#3b82f6' }}>
                                                        <div className="absolute top-0 left-0 h-full rounded-l-md" style={{width: `${task.completionPercentage || 0}%`, backgroundColor: 'rgba(0,0,0,0.2)'}}></div>
                                                        <div className="relative z-10 flex items-center justify-between w-full px-2">
                                                            <span className={`text-sm truncate font-medium ${getContrastingTextColor(task.taskColor || project.color)}`}>{task.name}</span>
                                                            {task.notes && task.notes.trim() !== '' && ( <StickyNote size={16} className={`flex-shrink-0 ${getContrastingTextColor(task.taskColor || project.color)}`} aria-label="Questa attività ha una nota" /> )}
                                                        </div>
                                                        <div draggable onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, task, 'resize-start'); }} className="absolute left-0 top-0 w-2 h-full cursor-ew-resize z-20" />
                                                        <div draggable onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, task, 'resize-end'); }} className="absolute right-0 top-0 w-2 h-full cursor-ew-resize z-20" />
                                                    </div>
                                                </div>

                                                {/* Placeholder for original position */}
                                                {isPlaceholderVisible && (
                                                    <div
                                                        title={`Pianificazione originale: ${new Date(task.originalStartDate).toLocaleDateString()} - ${new Date(task.originalEndDate).toLocaleDateString()}`}
                                                        className="absolute h-8 rounded-md bg-gray-300 border border-dashed border-gray-500 opacity-80"
                                                        style={{
                                                            top: '16px',
                                                            left: `${pos.originalLeft}px`,
                                                            width: `${pos.originalWidth}px`,
                                                            zIndex: 5
                                                        }}
                                                    />
                                                )}

                                                {/* Line indicator for the shift */}
                                                {isPlaceholderVisible && (() => {
                                                    const dayDiff = calculateDaysDifference(new Date(task.originalStartDate), new Date(task.startDate));
                                                    const isForward = dayDiff > 0;
                                                    const lineStart = isForward ? pos.originalLeft + pos.originalWidth : pos.left + pos.width;
                                                    const lineEnd = isForward ? pos.left : pos.originalLeft;
                                                    const lineWidth = Math.max(0, lineEnd - lineStart);

                                                    if (lineWidth <= 0) return null;

                                                    return (
                                                        <div
                                                            className="absolute top-1/2 -translate-y-1/2 h-px border-t border-dashed border-yellow-600"
                                                            style={{
                                                                left: `${lineStart}px`,
                                                                width: `${lineWidth}px`,
                                                                zIndex: 4
                                                            }}
                                                            title={`Spostato di ${dayDiff} giorni`}
                                                        >
                                                            <div
                                                                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-yellow-600"
                                                                style={{
                                                                    right: isForward ? '-4px' : 'auto',
                                                                    left: !isForward ? '-4px' : 'auto',
                                                                    clipPath: isForward ? 'polygon(0% 0%, 100% 50%, 0% 100%)' : 'polygon(100% 0%, 0% 50%, 100% 100%)'
                                                                }}
                                                            ></div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    }))}
                                    <svg width="100%" height="100%" className="absolute top-0 left-0 z-10 pointer-events-none">
                                      <defs> <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"> <path d="M 0 0 L 10 5 L 0 10 z" fill="#0ea5e9" /> </marker> </defs>
                                      {arrowPaths.map(path => (<path key={path.id} d={path.d} stroke="#0ea5e9" strokeWidth="2" fill="none" markerEnd="url(#arrowhead)" />))}
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : view === 'costReport' ? ( <CostReportView projectsWithData={projectsWithData} onExportPDF={() => exportToPDF('cost')} />
                ) : view === 'assignmentReport' ? ( <AssignmentReportView projectsWithData={projectsWithData} resources={resources} onExportPDF={() => exportToPDF('assignment')} /> )
                : ( <ActivityReportView projectsWithData={projectsWithData} onExportPDF={() => exportToPDF('activity')} /> )
                }
            </main>
             <Modal isOpen={isTaskModalOpen} onClose={() => {setEditingTask(null); setIsTaskModalOpen(false);}} title={editingTask ? 'Modifica Attività' : 'Nuova Attività'}> <TaskForm db={db} userId={userId} projects={projects} task={editingTask} resources={resources} allTasks={tasks} onDone={() => {setEditingTask(null); setIsTaskModalOpen(false);}} selectedProjectIdForNew={selectedProjectId} /> </Modal>
             <Modal isOpen={isResourceModalOpen} onClose={() => setIsResourceModalOpen(false)} title="Gestione Risorse"> <ResourceManagement resources={resources} db={db} userId={userId}/> </Modal>
             <Modal isOpen={isProjectModalOpen} onClose={() => {setEditingProject(null); setIsProjectModalOpen(false);}} title={editingProject && editingProject.id ? 'Modifica Progetto' : 'Nuovo Progetto'}> <ProjectForm project={editingProject} onDone={() => {setEditingProject(null); setIsProjectModalOpen(false);}} db={db} userId={userId} /> </Modal>
             <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Conferma Eliminazione"> <div><div className="p-4 bg-red-100 border-l-4 border-red-500 text-red-700"> <p className="font-bold">ATTENZIONE!</p><p>Stai per eliminare {itemToDelete?.type === 'project' ? `il progetto "${itemToDelete.item.name}" e tutte le sue attività` : `l'attività "${itemToDelete?.item.name}"`}. Questa azione è irreversibile.</p></div> <div className="flex justify-end mt-4 gap-2"> <button onClick={() => setItemToDelete(null)} className="bg-gray-300 px-4 py-2 rounded-md">Annulla</button> <button onClick={handleDeleteItem} className="bg-red-600 text-white px-4 py-2 rounded-md">Elimina</button></div></div></Modal>
             <Modal isOpen={isImportConfirmOpen} onClose={() => setIsImportConfirmOpen(false)} title="Conferma Importazione"> <div><div className="p-4 bg-red-100 border-l-4 border-red-500 text-red-700"> <p className="font-bold">ATTENZIONE!</p><p>Stai per sovrascrivere tutti i tuoi dati con il contenuto del file. Questa azione è irreversibile. Sei sicuro?</p></div> <div className="flex justify-end mt-4 gap-2"> <button onClick={() => setIsImportConfirmOpen(false)} className="bg-gray-300 px-4 py-2 rounded-md">Annulla</button> <button onClick={importData} className="bg-red-600 text-white px-4 py-2 rounded-md">Sì, sovrascrivi</button></div></div></Modal>
        </div>
    );
};

// --- COMPONENTE DI AUTENTICAZIONE ---
const AuthScreen = ({ auth, setNotification }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            setNotification({ message: 'Email e password sono obbligatori.', type: 'error' });
            return;
        }
        setIsLoading(true);
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            console.error(`Errore durante ${isLogin ? 'il login' : 'la registrazione'}:`, error);
            let message = "Si è verificato un errore.";
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                message = "Email o password non validi.";
            } else if (error.code === 'auth/email-already-in-use') {
                message = "Questo indirizzo email è già stato registrato.";
            }
            setNotification({ message: message, type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center p-4">
            <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8">
                <h2 className="text-3xl font-bold text-center text-gray-800 mb-2">{isLogin ? 'Accedi' : 'Registrati'}</h2>
                <p className="text-center text-gray-600 mb-8">Gestisci i tuoi progetti con facilità.</p>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700">Indirizzo Email</label>
                        <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"/>
                    </div>
                    <div>
                        <label htmlFor="password"className="block text-sm font-medium text-gray-700">Password</label>
                        <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500" />
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300">
                            {isLoading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : (isLogin ? 'Accedi' : 'Crea Account')}
                        </button>
                    </div>
                </form>
                <div className="text-center mt-6">
                    <button onClick={() => setIsLogin(!isLogin)} className="text-sm text-blue-600 hover:text-blue-500">
                        {isLogin ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- COMPONENTE RADICE ---
export default function App() {
    const [app, setApp] = useState(null);
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [user, setUser] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [notification, setNotification] = useState({ message: '', type: 'info' });
    const [projects, setProjects] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [resources, setResources] = useState([]);
    
    useEffect(() => {
        const scripts = [ { id: 'jspdf', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' }, { id: 'jspdf-autotable', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js' }, { id: 'html2canvas', src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' } ];
        scripts.forEach(scriptInfo => { if (!document.getElementById(scriptInfo.id)) { const script = document.createElement('script'); script.id = scriptInfo.id; script.src = scriptInfo.src; script.async = false; document.head.appendChild(script); } });
        
        try { 
            if (Object.values(firebaseConfig).every(v => v !== undefined) && firebaseConfig.projectId) { 
                const initializedApp = initializeApp(firebaseConfig); 
                const authInstance = getAuth(initializedApp);
                const firestoreInstance = getFirestore(initializedApp);
                setApp(initializedApp);
                setAuth(authInstance);
                setDb(firestoreInstance); 
                
                const unsubscribe = onAuthStateChanged(authInstance, (currentUser) => {
                    setUser(currentUser);
                    setIsAuthReady(true);
                });
                return () => unsubscribe();
            } else { 
                console.error("Configurazione Firebase non fornita o incompleta."); 
                setIsAuthReady(true); // Allow UI to render an error state
            } 
        } catch(e) { 
            console.error("Errore inizializzazione Firebase:", e); 
            setIsAuthReady(true); // Allow UI to render an error state
        }
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db || !user) {
            if (!user) {
                setProjects([]);
                setTasks([]);
                setResources([]);
            }
            return;
        };

        const userId = user.uid;

        const unsubProjects = onSnapshot(query(collection(db, `users/${userId}/projects`)), snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubTasks = onSnapshot(query(collection(db, `users/${userId}/tasks`)), snap => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubResources = onSnapshot(query(collection(db, `users/${userId}/resources`)), snap => setResources(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        
        return () => { unsubProjects(); unsubTasks(); unsubResources(); };
    }, [isAuthReady, db, user]);

    if (!isAuthReady) {
        return <div className="h-screen w-screen flex justify-center items-center bg-gray-100"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mr-4"></div><div className="text-xl font-semibold">Caricamento...</div></div>;
    }
    
    if (!auth || !db) {
         return (
             <div className="h-screen w-screen flex flex-col justify-center items-center bg-gray-100 p-4">
                 <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
                    <h2 className="text-2xl font-bold text-red-600 mb-4">Errore di Configurazione</h2>
                    <p className="text-gray-700">La configurazione di Firebase non è stata caricata correttamente.</p>
                    <p className="text-gray-500 mt-2 text-sm">Assicurati che le credenziali per l'ambiente siano state fornite correttamente.</p>
                 </div>
             </div>
        );
    }


    if (!user) {
        return (
            <>
                <Notification message={notification.message} type={notification.type} onClose={() => setNotification({ message: '' })} />
                <AuthScreen auth={auth} setNotification={setNotification} />
            </>
        );
    }
    
    return <MainDashboard projects={projects} tasks={tasks} resources={resources} db={db} userId={user.uid} auth={auth} />;
}
