import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Search, Pin, PinOff, Trash2, Edit3, Settings, 
  LogOut, Moon, Sun, Lock, Unlock, Mic, Square, 
  CheckSquare, Square as SquareIcon, ChevronLeft, 
  MoreVertical, Tag, Calendar, Bell, FileText, 
  Download, Share2, Filter, X, Check, MessageSquare, Camera,
  Bold, Italic, Strikethrough, Code, Quote, Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { GoogleGenAI } from "@google/genai";
import { 
  auth, db, storage, signIn, logout, 
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, Timestamp, getDocs,
  OperationType, handleFirestoreError,
  ref, uploadBytes, getDownloadURL, deleteObject
} from './firebase';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { getDocFromServer } from 'firebase/firestore';
import { Note, NoteType, ChecklistItem, UserProfile } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const errObj = JSON.parse(this.state.error.message);
        if (errObj.error) message = `Firestore Error: ${errObj.error} (${errObj.operationType} on ${errObj.path})`;
      } catch (e) {
        message = this.state.error.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <Shield className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Application Error</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
            <Button onClick={() => window.location.reload()} variant="primary" className="w-full">
              Reload Application
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const Button = ({ 
  children, className, variant = 'primary', size = 'md', ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' }) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };
  return (
    <button 
      className={cn('rounded-xl font-medium transition-all active:scale-95 flex items-center justify-center gap-2', variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn('w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white', className)}
    {...props}
  />
);

const Card = ({ children, className, onClick, onContextMenu }: { children: React.ReactNode, className?: string, onClick?: () => void, onContextMenu?: (e: React.MouseEvent) => void }) => (
  <motion.div 
    layout
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.9 }}
    onClick={onClick}
    onContextMenu={onContextMenu}
    className={cn('bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 cursor-pointer hover:shadow-md transition-shadow', className)}
  >
    {children}
  </motion.div>
);

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/note/:noteId" element={<PublicNoteView />} />
      </Routes>
    </ErrorBoundary>
  );
}

function MainApp() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isEditing, setIsEditing] = useState<Note | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isVaultLocked, setIsVaultLocked] = useState(true);
  const [lockInput, setLockInput] = useState('');
  const [vaultInput, setVaultInput] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showAdminVault, setShowAdminVault] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const profileInputRef = useRef<HTMLInputElement>(null);

  // --- Storage Helper ---
  const uploadFile = async (path: string, file: Blob | File) => {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  // Code Protection
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
        (e.ctrlKey && e.key === 'u')
      ) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // --- Auth ---
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return unsub;
  }, []);

  // --- Profile & Notes ---
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    if (!user) {
      setProfile(null);
      setNotes([]);
      return;
    }

    const userDoc = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(userDoc, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (data.status === 'banned' && user.email !== 'dishandishan563@gmail.com') {
          alert('Your account has been suspended by the administrator.');
          logout();
          return;
        }
        setProfile(data);
        setDarkMode(data.settings.darkMode);
        if (data.settings.lockEnabled && isLocked === false && lockInput === '') {
           setIsLocked(true);
        }
      } else {
        const newProfile: UserProfile & { role?: string } = {
          uid: user.uid,
          email: user.email!,
          displayName: user.displayName || 'User',
          photoURL: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
          settings: { darkMode: false, lockEnabled: false },
          status: 'active',
          role: user.email === 'dishandishan563@gmail.com' ? 'admin' : 'user',
          createdAt: serverTimestamp()
        };
        try {
          setDoc(userDoc, newProfile);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        }
        setShowOnboarding(true);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    });

    const qOwned = query(collection(db, 'notes'), where('ownerId', '==', user.uid));
    const qCollab = query(collection(db, 'notes'), where('collaborators', 'array-contains', user.uid));
    
    const unsubOwned = onSnapshot(qOwned, (snap) => {
      const owned = snap.docs.map(d => ({ id: d.id, ...d.data() } as Note));
      setNotes(prev => {
        const other = prev.filter(n => n.ownerId !== user.uid);
        return [...owned, ...other];
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'notes (owned)');
    });

    const unsubCollab = onSnapshot(qCollab, (snap) => {
      const collab = snap.docs.map(d => ({ id: d.id, ...d.data() } as Note));
      setNotes(prev => {
        const other = prev.filter(n => !n.collaborators?.includes(user.uid));
        return [...collab, ...other];
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'notes (collab)');
    });

    return () => {
      unsubProfile();
      unsubOwned();
      unsubCollab();
    };
  }, [user?.uid]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = async () => {
    if (!user) return;
    const newMode = !darkMode;
    setDarkMode(newMode);
    try {
      await updateDoc(doc(db, 'users', user.uid), { 'settings.darkMode': newMode });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && user) {
      try {
        const url = await uploadFile(`profiles/${user.uid}/${Date.now()}_${file.name}`, file);
        await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
      }
    }
  };

  const toggleSelectNote = (id: string) => {
    setSelectedNoteIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const deleteSelectedNotes = async () => {
    if (confirm(`Delete ${selectedNoteIds.length} notes?`)) {
      for (const id of selectedNoteIds) {
        try {
          await deleteDoc(doc(db, 'notes', id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `notes/${id}`);
        }
      }
      setSelectedNoteIds([]);
      setIsSelectMode(false);
    }
  };

  // --- Note Actions ---
  const handleAddNote = async (type: NoteType = 'text') => {
    if (!user) return;
    const newNote: Partial<Note> = {
      ownerId: user.uid,
      collaborators: [],
      title: '',
      content: '',
      category: 'General',
      tags: [],
      isPinned: false,
      isPrivate: showVault,
      isPublic: false,
      type,
      checklist: type === 'todo' ? [] : undefined,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const noteRef = doc(collection(db, 'notes'));
    try {
      await setDoc(noteRef, newNote);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notes');
    }
    setIsEditing({ id: noteRef.id, ...newNote } as Note);
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this note?')) {
      try {
        await deleteDoc(doc(db, 'notes', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `notes/${id}`);
      }
    }
  };

  const togglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, 'notes', note.id), { isPinned: !note.isPinned, updatedAt: serverTimestamp() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notes/${note.id}`);
    }
  };

  // --- Filtering ---
  const filteredNotes = notes.filter(n => {
    const matchesSearch = n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || n.category === selectedCategory;
    const matchesVault = showVault ? n.isPrivate : !n.isPrivate;
    return matchesSearch && matchesCategory && matchesVault;
  }).sort((a, b) => (a.isPinned === b.isPinned ? 0 : a.isPinned ? -1 : 1));

  const categories = ['All', ...Array.from(new Set(notes.map(n => n.category))).filter(c => c !== 'All')];

  // --- Render Helpers ---
  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-indigo-600 rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-indigo-500/20"
        >
          <Edit3 className="text-white w-12 h-12" />
        </motion.div>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">SmartNotes</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-12 max-w-xs">Your modern companion for capturing ideas, lists, and voice notes.</p>
        <Button onClick={signIn} size="lg" className="w-full max-w-xs py-4">
          Get Started with Google
        </Button>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6">
        <Lock className="w-16 h-16 text-indigo-600 mb-8" />
        <h2 className="text-2xl font-bold dark:text-white mb-6">App Locked</h2>
        <Input 
          type="password" 
          placeholder="Enter Password" 
          className="max-w-xs text-center mb-4"
          value={lockInput}
          onChange={(e) => setLockInput(e.target.value)}
        />
        <Button onClick={() => {
          if (lockInput === profile?.settings.lockPassword || !profile?.settings.lockPassword) {
            setIsLocked(false);
          } else {
            alert('Wrong password');
          }
        }} className="w-full max-w-xs">Unlock</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 pb-24 transition-colors duration-300">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSelectMode ? (
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => { setIsSelectMode(false); setSelectedNoteIds([]); }}><X size={20} /></Button>
              <span className="font-bold text-indigo-600">{selectedNoteIds.length} Selected</span>
            </div>
          ) : (
            <>
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Edit3 className="text-white w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">SmartNotes</h1>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSelectMode ? (
            <Button variant="danger" size="sm" onClick={deleteSelectedNotes}><Trash2 size={20} /></Button>
          ) : (
            <>
              <Button 
                variant={showVault ? "primary" : "ghost"} 
                size="sm" 
                onClick={() => {
                  if (!showVault && isVaultLocked && profile?.settings.lockEnabled) {
                    setShowVault(true);
                  } else {
                    setShowVault(!showVault);
                  }
                }}
              >
                {showVault ? <Unlock size={20} /> : <Lock size={20} />}
              </Button>
              <Button variant="ghost" size="sm" onClick={toggleDarkMode}>
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
                <Settings size={20} />
              </Button>
              <div className={cn("px-2 py-1 rounded-full text-[10px] font-bold uppercase", isOnline ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600")}>
                {isOnline ? "Online" : "Offline"}
              </div>
              <div className="relative group">
                <img src={profile?.photoURL || user.photoURL} className="w-10 h-10 rounded-full border-2 border-indigo-100 dark:border-gray-800 object-cover" alt="Profile" />
                <button 
                  onClick={() => profileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center border-2 border-white dark:border-gray-950 shadow-sm active:scale-110 transition-transform"
                >
                  <Plus size={12} />
                </button>
                <input type="file" ref={profileInputRef} onChange={handleProfilePicUpload} className="hidden" accept="image/*" />
              </div>
            </>
          )}
        </div>
      </header>

      {showVault && isVaultLocked && profile?.settings.lockEnabled && (
        <div className="px-6 py-12 flex flex-col items-center justify-center bg-indigo-50 dark:bg-indigo-900/10 rounded-3xl mx-6 mt-4">
          <Lock className="w-12 h-12 text-indigo-600 mb-4" />
          <h3 className="text-xl font-bold mb-4">Vault Locked</h3>
          <Input 
            type="password" 
            placeholder="Vault Password" 
            className="max-w-xs text-center mb-4"
            value={vaultInput}
            onChange={(e) => setVaultInput(e.target.value)}
          />
          <Button onClick={() => {
            if (vaultInput === profile?.settings.lockPassword) {
              setIsVaultLocked(false);
            } else {
              alert('Incorrect Password');
            }
          }}>Unlock Vault</Button>
        </div>
      )}

      <main className={cn("px-6 pt-4", showVault && isVaultLocked && profile?.settings.lockEnabled && "hidden")}>
        {/* Search & Filter */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input 
            placeholder="Search your notes..." 
            className="pl-12 bg-white dark:bg-gray-900 shadow-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                selectedCategory === cat 
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20" 
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-800"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Notes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <AnimatePresence mode="popLayout">
            {filteredNotes.map(note => (
              <Card 
                key={note.id} 
                onClick={() => isSelectMode ? toggleSelectNote(note.id) : setIsEditing(note)} 
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!isSelectMode) {
                    setIsSelectMode(true);
                    toggleSelectNote(note.id);
                  }
                }}
                className={cn(
                  "relative group min-h-[160px] flex flex-col transition-all duration-200 cursor-pointer",
                  selectedNoteIds.includes(note.id) && "ring-4 ring-indigo-500 scale-[0.98] bg-indigo-50 dark:bg-indigo-900/10"
                )}
              >
                <div className="flex justify-between items-start mb-2 relative z-10">
                  <div className="flex items-center gap-2 flex-1">
                    {isSelectMode && (
                      <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors", selectedNoteIds.includes(note.id) ? "bg-indigo-600 border-indigo-600" : "border-gray-300")}>
                        {selectedNoteIds.includes(note.id) && <Check size={12} className="text-white" />}
                      </div>
                    )}
                    <h3 className="font-bold text-lg leading-tight pr-8 line-clamp-1">{note.title || 'Untitled Note'}</h3>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={(e) => { e.stopPropagation(); togglePin(note, e); }}
                      className={cn("p-1.5 rounded-lg transition-colors", note.isPinned ? "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800")}
                    >
                      {note.isPinned ? <Pin size={16} /> : <PinOff size={16} />}
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 relative z-10">
                  {note.type === 'todo' ? (
                    <div className="space-y-1 mb-4">
                      {note.checklist?.slice(0, 3).map(item => (
                        <div key={item.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          {item.completed ? <CheckSquare size={14} className="text-indigo-600" /> : <SquareIcon size={14} />}
                          <span className={cn("truncate", item.completed && "line-through opacity-50")}>{item.text || 'Empty item'}</span>
                        </div>
                      ))}
                      {(note.checklist?.length || 0) > 3 && (
                        <p className="text-[10px] text-gray-400 mt-1">+{note.checklist!.length - 3} more items</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-3 mb-4 overflow-hidden">
                      {note.content || 'No content...'}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50 dark:border-gray-800 relative z-10">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-500">
                      {note.category}
                    </span>
                    {note.type === 'voice' && <Mic size={12} className="text-red-500" />}
                    {note.isPublic && <Share2 size={12} className="text-blue-500" />}
                    {note.collaborators && note.collaborators.length > 0 && <MoreVertical size={12} className="text-green-500" />}
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {format(note.updatedAt?.toDate() || new Date(), 'MMM d, h:mm a')}
                  </span>
                </div>

                {!isSelectMode && (
                  <button 
                    onClick={(e) => handleDeleteNote(note.id, e)}
                    className="absolute top-2 right-2 p-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg z-20"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </Card>
            ))}
          </AnimatePresence>
        </div>

        <footer className="mt-20 pb-10 text-center">
          <p className="text-xs text-gray-400 font-medium tracking-widest uppercase">Developed by Ashish</p>
          <p className="text-[10px] text-gray-300 mt-1">SmartNotes v2.0 • 2026</p>
        </footer>

        {filteredNotes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
            <div className="w-20 h-20 bg-gray-200 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <FileText size={32} />
            </div>
            <p className="text-lg font-medium">No notes found</p>
            <p className="text-sm">Try a different search or add a new note.</p>
          </div>
        )}
      </main>

      {/* FAB */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-3 items-end">
        <AnimatePresence>
          {isAdding && (
            <>
              <motion.button
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.8 }}
                onClick={() => { handleAddNote('todo'); setIsAdding(false); }}
                className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 flex items-center gap-3 text-sm font-bold"
              >
                <CheckSquare className="text-indigo-600" size={20} /> Checklist
              </motion.button>
              <motion.button
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.8 }}
                onClick={() => { 
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = async (e: any) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = async () => {
                        const base64Data = (reader.result as string).split(',')[1];
                        const result = await genAI.models.generateContent({
                          model: "gemini-3-flash-preview",
                          contents: [{
                            parts: [
                              { text: "Extract all text from this image and format it as a note." },
                              { inlineData: { data: base64Data, mimeType: file.type } }
                            ]
                          }]
                        });
                        const newNote: Partial<Note> = {
                          ownerId: user.uid,
                          title: 'Scanned Note',
                          content: result.text || '',
                          category: 'General',
                          type: 'text',
                          createdAt: serverTimestamp(),
                          updatedAt: serverTimestamp()
                        };
                        const noteRef = doc(collection(db, 'notes'));
                        try {
                          await setDoc(noteRef, newNote);
                        } catch (err) {
                          handleFirestoreError(err, OperationType.CREATE, 'notes');
                        }
                        setIsEditing({ id: noteRef.id, ...newNote } as Note);
                      };
                      reader.readAsDataURL(file);
                    }
                  };
                  input.click();
                  setIsAdding(false); 
                }}
                className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 flex items-center gap-3 text-sm font-bold"
              >
                <Camera className="text-blue-500" size={20} /> Scan Document
              </motion.button>
              <motion.button
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.8 }}
                onClick={() => { handleAddNote('voice'); setIsAdding(false); }}
                className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 flex items-center gap-3 text-sm font-bold"
              >
                <Mic className="text-red-500" size={20} /> Voice Note
              </motion.button>
            </>
          )}
        </AnimatePresence>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className={cn(
            "w-16 h-16 rounded-3xl flex items-center justify-center shadow-2xl transition-all active:scale-90",
            isAdding ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 rotate-45" : "bg-indigo-600 text-white shadow-indigo-500/40"
          )}
        >
          <Plus size={32} />
        </button>

        <button 
          onClick={() => setShowAIAssistant(true)}
          className="w-14 h-14 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
        >
          <MessageSquare size={24} />
        </button>
      </div>

      {/* AI Assistant Modal */}
      <AnimatePresence>
        {showAIAssistant && (
          <AIAssistant onClose={() => setShowAIAssistant(false)} />
        )}
      </AnimatePresence>

      {/* Note Editor Modal */}
      <AnimatePresence>
        {isEditing && (
          <NoteEditor 
            note={isEditing} 
            onClose={() => setIsEditing(null)} 
            onSave={async (updated) => {
              try {
                await updateDoc(doc(db, 'notes', isEditing.id), { ...updated, updatedAt: serverTimestamp() });
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `notes/${isEditing.id}`);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal 
            profile={profile} 
            onClose={() => setShowSettings(false)} 
            onLogout={() => { logout(); setShowSettings(false); }}
            onOpenAdmin={() => setShowAdminVault(true)}
          />
        )}
      </AnimatePresence>

      {/* Admin Vault Modal */}
      <AnimatePresence>
        {showAdminVault && <AdminVault onClose={() => setShowAdminVault(false)} />}
      </AnimatePresence>

      {/* Onboarding */}
      <AnimatePresence>
        {showOnboarding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-indigo-600 flex flex-col items-center justify-center p-8 text-white text-center"
          >
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-4xl font-bold mb-4">Welcome to SmartNotes</h2>
              <p className="text-indigo-100 mb-12 text-lg">Capture your thoughts, organize your life, and sync everywhere.</p>
              <div className="space-y-4 w-full max-w-xs">
                <div className="flex items-center gap-4 text-left">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0"><Edit3 /></div>
                  <div><p className="font-bold">Rich Text</p><p className="text-sm text-indigo-100">Format with Markdown</p></div>
                </div>
                <div className="flex items-center gap-4 text-left">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0"><Mic /></div>
                  <div><p className="font-bold">Voice Notes</p><p className="text-sm text-indigo-100">Record on the go</p></div>
                </div>
                <div className="flex items-center gap-4 text-left">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0"><Lock /></div>
                  <div><p className="font-bold">Private Notes</p><p className="text-sm text-indigo-100">Keep secrets safe</p></div>
                </div>
              </div>
              <Button 
                onClick={() => setShowOnboarding(false)} 
                className="mt-12 w-full bg-white text-indigo-600 hover:bg-indigo-50"
                size="lg"
              >
                Let's Go!
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PublicNoteView() {
  const { noteId } = useParams();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!noteId) return;
    const fetchNote = async () => {
      try {
        const snap = await getDoc(doc(db, 'notes', noteId));
        if (snap.exists()) {
          const data = snap.data() as Note;
          if (data.isPublic) {
            setNote({ id: snap.id, ...data });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `notes/${noteId}`);
      } finally {
        setLoading(false);
      }
    };
    fetchNote();
  }, [noteId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 p-6 text-center">
        <Lock className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Note Not Available</h2>
        <p className="text-gray-500">This note is private or does not exist.</p>
        <Button className="mt-8" onClick={() => window.location.href = '/'}>Go to Home</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Edit3 className="text-indigo-600" />
          <span className="font-bold">SmartNotes</span>
        </div>
        <span className="text-xs text-gray-400">Shared Note</span>
      </header>

      <h1 className="text-4xl font-bold mb-4 dark:text-white">{note.title}</h1>
      <div className="flex gap-2 mb-8">
        <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs font-bold text-gray-500">{note.category}</span>
        <span className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-full text-xs font-bold text-blue-600">Public</span>
      </div>

      {note.type === 'todo' ? (
        <div className="space-y-3">
          {note.checklist?.map(item => (
            <div key={item.id} className="flex items-center gap-3">
              {item.completed ? <CheckSquare className="text-indigo-600" /> : <SquareIcon className="text-gray-300" />}
              <span className={cn("flex-1", item.completed && "line-through text-gray-400")}>{item.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="prose dark:prose-invert max-w-none">
          <Markdown>{note.content}</Markdown>
        </div>
      )}

      {note.type === 'voice' && note.voiceUrl && (
        <div className="mt-8 p-6 bg-gray-50 dark:bg-gray-900 rounded-3xl">
          <audio src={note.voiceUrl} controls className="w-full" />
        </div>
      )}

      <footer className="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800 text-center">
        <p className="text-sm text-gray-400 mb-4">Capture your own ideas with SmartNotes</p>
        <Button onClick={() => window.location.href = '/'}>Create Account</Button>
      </footer>
    </div>
  );
}

// --- Sub-Components ---

function NoteEditor({ note, onClose, onSave }: { note: Note, onClose: () => void, onSave: (n: Partial<Note>) => void }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [category, setCategory] = useState(note.category);
  const [isPublic, setIsPublic] = useState(note.isPublic || false);
  const [isPrivate, setIsPrivate] = useState(note.isPrivate || false);
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(note.checklist || []);
  const [images, setImages] = useState<string[]>(note.images || []);
  const [isRecording, setIsRecording] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save logic
  useEffect(() => {
    const timer = setTimeout(() => {
      onSave({ title, content, category, checklist, isPublic, isPrivate, images });
    }, 1000);
    return () => clearTimeout(timer);
  }, [title, content, category, checklist, isPublic, isPrivate, images]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && auth.currentUser) {
      setIsAIProcessing(true);
      try {
        const storageRef = ref(storage, `notes/${auth.currentUser.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        setImages(prev => [...prev, url]);
      } catch (err) {
        console.error(err);
        alert("Image upload failed.");
      } finally {
        setIsAIProcessing(false);
      }
    }
  };

  const takePhoto = async () => {
    try {
      const image = await CapacitorCamera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt
      });

      if (image.base64String && auth.currentUser) {
        setIsAIProcessing(true);
        const blob = await (await fetch(`data:image/${image.format};base64,${image.base64String}`)).blob();
        const storageRef = ref(storage, `notes/${auth.currentUser.uid}/${Date.now()}.jpg`);
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        setImages(prev => [...prev, url]);
        setIsAIProcessing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const askAI = async () => {
    if (!content) return;
    setIsAIProcessing(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Analyze this note and provide a summary or helpful suggestions: \n\nTitle: ${title}\nContent: ${content}` }] }]
      });
      setContent(prev => prev + "\n\n--- AI Assistant ---\n" + (result.text || ''));
    } catch (err) {
      console.error(err);
      alert("AI processing failed. Check your API key.");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const scanDocument = async () => {
    try {
      const image = await CapacitorCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera
      });

      if (image.base64String) {
        setIsAIProcessing(true);
        try {
          const result = await genAI.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{
              parts: [
                { text: "Extract all text from this image and format it as a note." },
                { inlineData: { data: image.base64String, mimeType: `image/${image.format}` } }
              ]
            }]
          });
          setContent(prev => prev + "\n\n--- Scanned Text ---\n" + (result.text || ''));
        } catch (err) {
          console.error(err);
          alert("Scanning failed.");
        } finally {
          setIsAIProcessing(false);
        }
      }
    } catch (err) {
      console.log("Camera cancelled or failed, falling back to file picker", err);
      if (scanInputRef.current) {
        scanInputRef.current.click();
      }
    }
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsAIProcessing(true);
      try {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          const result = await genAI.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{
              parts: [
                { text: "Extract all text from this image and format it as a note." },
                { inlineData: { data: base64Data, mimeType: file.type } }
              ]
            }]
          });
          setContent(prev => prev + "\n\n--- Scanned Text ---\n" + (result.text || ''));
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
        alert("Scanning failed.");
      } finally {
        setIsAIProcessing(false);
      }
    }
  };

  const addCollaborator = async () => {
    if (!collaboratorEmail) return;
    // In a real app, we'd lookup the UID by email. 
    // Here we'll simulate by assuming the email is the UID for demo purposes or just adding it to a list.
    // Actually, Firestore rules expect UIDs. Let's just add the email to a list for now.
    // Note: This is a simplification.
    const updatedCollabs = [...(note.collaborators || []), collaboratorEmail];
    onSave({ collaborators: updatedCollabs });
    setCollaboratorEmail('');
  };

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  };

  const addCheckItem = () => {
    setChecklist(prev => [...prev, { id: Date.now().toString(), text: '', completed: false }]);
  };

  const updateCheckItem = (id: string, text: string) => {
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, text } : item));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
        setAudioBlob(blob);
        if (auth.currentUser) {
          setIsAIProcessing(true);
          try {
            const storageRef = ref(storage, `voice/${auth.currentUser.uid}/${Date.now()}.ogg`);
            await uploadBytes(storageRef, blob);
            const url = await getDownloadURL(storageRef);
            onSave({ voiceUrl: url, type: 'voice' });
          } catch (err) {
            console.error(err);
          } finally {
            setIsAIProcessing(false);
          }
        }
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      alert('Microphone access denied');
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  };

  const exportAsText = () => {
    const text = `${title}\n\n${content}\n\nCategory: ${category}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'note'}.txt`;
    a.click();
  };

  const shareLink = `${window.location.origin}/note/${note.id}`;

  const insertFormat = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    const newText = before + prefix + selectedText + suffix + after;
    setContent(newText);

    // Reset cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      className="fixed inset-0 z-50 bg-white dark:bg-gray-950 flex flex-col"
    >
      <header className="px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
        <Button variant="ghost" size="sm" onClick={onClose}><ChevronLeft /> Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPreviewMode(!previewMode)}>
            {previewMode ? <Edit3 size={18} /> : <FileText size={18} />}
          </Button>
          <Button variant="ghost" size="sm" onClick={takePhoto}>
            <Plus size={18} />
          </Button>
          <Button variant="ghost" size="sm" onClick={askAI} disabled={isAIProcessing}>
            <MessageSquare size={18} className={cn(isAIProcessing && "animate-pulse text-indigo-600")} />
          </Button>
          <Button variant="ghost" size="sm" onClick={scanDocument} disabled={isAIProcessing}>
            <Camera size={18} />
          </Button>
          <Button variant="ghost" size="sm" onClick={exportAsText}><Download size={18} /></Button>
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
      <input type="file" ref={scanInputRef} onChange={handleScan} className="hidden" accept="image/*" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
            {images.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <img src={img} className="h-40 rounded-xl shadow-md" alt="Note" />
                <button 
                  onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full text-3xl font-bold bg-transparent outline-none dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-700"
        />

        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex gap-2 items-center">
            <Tag size={16} className="text-gray-400" />
            <select 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg text-sm outline-none"
            >
              <option>General</option>
              <option>Work</option>
              <option>Personal</option>
              <option>Ideas</option>
              <option>To-do</option>
            </select>
          </div>

          <div className="flex gap-2 items-center">
            <button 
              onClick={() => setIsPublic(!isPublic)}
              className={cn("flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors", isPublic ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500")}
            >
              <Share2 size={14} /> {isPublic ? "Public" : "Private Link"}
            </button>
            <button 
              onClick={() => setIsPrivate(!isPrivate)}
              className={cn("flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors", isPrivate ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500")}
            >
              <Lock size={14} /> {isPrivate ? "In Vault" : "Regular"}
            </button>
          </div>
        </div>

        {isPublic && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl flex items-center justify-between gap-4">
            <p className="text-xs text-blue-600 truncate flex-1">{shareLink}</p>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(shareLink); alert('Link copied!'); }}>Copy</Button>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase">Collaborators</p>
          <div className="flex gap-2">
            <Input 
              placeholder="Enter User ID/Email" 
              className="py-2 text-sm" 
              value={collaboratorEmail}
              onChange={(e) => setCollaboratorEmail(e.target.value)}
            />
            <Button size="sm" onClick={addCollaborator}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {note.collaborators?.map(c => (
              <span key={c} className="px-2 py-1 bg-green-100 text-green-700 text-[10px] rounded-full font-bold">{c}</span>
            ))}
          </div>
        </div>

        {note.type === 'todo' ? (
          <div className="space-y-3">
            {checklist.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <button onClick={() => toggleCheck(item.id)}>
                  {item.completed ? <CheckSquare className="text-indigo-600" /> : <SquareIcon className="text-gray-300" />}
                </button>
                <input 
                  value={item.text}
                  onChange={(e) => updateCheckItem(item.id, e.target.value)}
                  className={cn("flex-1 bg-transparent outline-none", item.completed && "line-through text-gray-400")}
                  placeholder="List item..."
                />
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addCheckItem} className="w-full border-2 border-dashed border-gray-100 dark:border-gray-800">
              <Plus size={18} /> Add Item
            </Button>
          </div>
        ) : previewMode ? (
          <div className="prose dark:prose-invert max-w-none">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <div className="flex flex-col h-full space-y-4">
            <div className="flex items-center gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl w-fit">
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => insertFormat('**', '**')}><Bold size={14} /></Button>
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => insertFormat('*', '*')}><Italic size={14} /></Button>
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => insertFormat('~~', '~~')}><Strikethrough size={14} /></Button>
              <div className="w-px h-4 bg-gray-200 dark:bg-gray-800 mx-1" />
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => insertFormat('```\n', '\n```')}><Code size={14} /></Button>
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => insertFormat('> ')}><Quote size={14} /></Button>
            </div>
            <textarea 
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start typing..."
              className="w-full h-full min-h-[300px] bg-transparent outline-none resize-none dark:text-gray-300 leading-relaxed"
            />
          </div>
        )}

        {note.type === 'voice' && (
          <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-3xl flex flex-col items-center gap-4">
            {note.voiceUrl ? (
              <audio src={note.voiceUrl} controls className="w-full" />
            ) : (
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400 font-bold mb-4">Voice Recording</p>
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={cn(
                    "w-20 h-20 rounded-full flex items-center justify-center transition-all",
                    isRecording ? "bg-red-600 animate-pulse" : "bg-red-500"
                  )}
                >
                  {isRecording ? <Square className="text-white" /> : <Mic className="text-white" size={32} />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex items-center gap-4 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 text-xs text-gray-400 whitespace-nowrap">
          <Calendar size={14} /> Last edited {format(new Date(), 'MMM d, h:mm a')}
        </div>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-800" />
        <div className="flex gap-4">
          <button className="text-gray-400 hover:text-indigo-600"><Bell size={18} /></button>
          <button className="text-gray-400 hover:text-indigo-600"><Share2 size={18} /></button>
          <button className="text-gray-400 hover:text-indigo-600"><Lock size={18} /></button>
        </div>
      </footer>
    </motion.div>
  );
}

function AIAssistant({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([
    { role: 'ai', text: 'Hello! I am your SmartNotes Assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input) return;
    const userMsg = { role: 'user' as const, text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: input }] }]
      });
      setMessages(prev => [...prev, { role: 'ai', text: result.text || 'No response' }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'ai', text: 'Sorry, I encountered an error. Please check your connection.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl shadow-2xl flex flex-col h-[600px] overflow-hidden">
        <header className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <MessageSquare className="text-white" />
            </div>
            <h3 className="font-bold">AI Assistant</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X /></Button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[80%] p-4 rounded-2xl text-sm",
                m.role === 'user' ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              )}>
                <Markdown>{m.text}</Markdown>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-2xl animate-pulse">
                Thinking...
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 dark:border-gray-800 flex gap-2">
          <Input 
            placeholder="Ask me anything..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          />
          <Button onClick={handleSend} disabled={loading}>Send</Button>
        </div>
      </div>
    </motion.div>
  );
}

function AdminVault({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminPass, setAdminPass] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);

  useEffect(() => {
    if (isUnlocked) {
      const fetchUsers = async () => {
        try {
          const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
          const snap = await getDocs(q);
          setUsers(snap.docs.map(d => d.data() as UserProfile));
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } finally {
          setLoading(false);
        }
      };
      fetchUsers();
    }
  }, [isUnlocked]);

  const toggleUserStatus = async (uid: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'banned' : 'active';
    try {
      await updateDoc(doc(db, 'users', uid), { status: newStatus });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: newStatus as any } : u));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  if (!isUnlocked) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex items-center justify-center p-6">
        <div className="bg-gray-900 p-8 rounded-3xl w-full max-w-sm space-y-6 text-center">
          <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="text-white" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white">Admin Vault</h2>
          <Input 
            type="password" 
            placeholder="Enter Admin Password" 
            value={adminPass} 
            onChange={e => setAdminPass(e.target.value)}
            className="bg-gray-800 border-gray-700 text-white"
          />
          {adminPass === 'Ashish@@Banna' && (
            <Button onClick={() => setIsUnlocked(true)} className="w-full bg-red-600 hover:bg-red-700">Open Vault</Button>
          )}
          <Button variant="ghost" onClick={onClose} className="text-gray-400">Cancel</Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-gray-950 flex flex-col">
      <header className="p-6 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="text-red-500" /> User Management
        </h2>
        <Button variant="ghost" onClick={onClose}><X className="text-white" /></Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading ? (
          <p className="text-center text-gray-500">Loading users...</p>
        ) : (
          users.map(u => (
            <div key={u.uid} className="bg-gray-900 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={u.photoURL} className="w-10 h-10 rounded-xl" alt="" />
                <div>
                  <p className="font-bold text-white text-sm">{u.displayName}</p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                  u.status === 'active' ? "bg-green-900/30 text-green-500" : "bg-red-900/30 text-red-500"
                )}>
                  {u.status}
                </span>
                <Button 
                  size="sm" 
                  variant={u.status === 'active' ? 'danger' : 'primary'}
                  onClick={() => toggleUserStatus(u.uid, u.status)}
                  className="text-xs px-3 py-1"
                >
                  {u.status === 'active' ? 'Ban' : 'Restore'}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

function SettingsModal({ profile, onClose, onLogout, onOpenAdmin }: { profile: UserProfile | null, onClose: () => void, onLogout: () => void, onOpenAdmin: () => void }) {
  const [lockEnabled, setLockEnabled] = useState(profile?.settings.lockEnabled || false);
  const [password, setPassword] = useState(profile?.settings.lockPassword || '');
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [photoURL, setPhotoURL] = useState(profile?.photoURL || '');

  const saveSettings = async () => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName,
        photoURL,
        'settings.lockEnabled': lockEnabled,
        'settings.lockPassword': password
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    }
    onClose();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        className="bg-white dark:bg-gray-950 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-8 space-y-8 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Settings</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X /></Button>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-xs font-bold text-gray-400 uppercase">Profile</p>
            <div className="flex items-center gap-4">
              <img src={photoURL} className="w-16 h-16 rounded-2xl object-cover border-2 border-indigo-100" alt="Preview" />
              <div className="flex-1 space-y-2">
                <Input placeholder="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                <Input placeholder="Photo URL" value={photoURL} onChange={e => setPhotoURL(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600"><Lock size={20} /></div>
              <div>
                <p className="font-bold">Vault Lock</p>
                <p className="text-xs text-gray-500">Secure private notes</p>
              </div>
            </div>
            <button 
              onClick={() => setLockEnabled(!lockEnabled)}
              className={cn("w-12 h-6 rounded-full transition-colors relative", lockEnabled ? "bg-indigo-600" : "bg-gray-200 dark:bg-gray-800")}
            >
              <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", lockEnabled ? "left-7" : "left-1")} />
            </button>
          </div>

          {lockEnabled && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-2">
              <Input 
                type="password" 
                placeholder="Set Vault Password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-[10px] text-gray-400">This password will be required to unlock the Hidden Vault.</p>
            </motion.div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600"><Download size={20} /></div>
              <div>
                <p className="font-bold">Cloud Sync</p>
                <p className="text-xs text-gray-500">Auto-syncing enabled</p>
              </div>
            </div>
            <Check className="text-green-500" />
          </div>
        </div>

        <div className="pt-8 border-t border-gray-100 dark:border-gray-800 space-y-4 text-center">
          <p 
            className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2 cursor-pointer select-none"
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenAdmin();
            }}
          >
            Developed by Ashish
          </p>
          <Button onClick={saveSettings} className="w-full">Save Changes</Button>
          <Button variant="danger" onClick={onLogout} className="w-full"><LogOut size={18} /> Logout</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
