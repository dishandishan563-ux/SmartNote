import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Plus, Search, Pin, PinOff, Trash2, Edit3, Settings, 
  LogOut, Moon, Sun, Lock, Unlock, Mic, Square, 
  CheckSquare, Square as SquareIcon, ChevronLeft, ChevronRight,
  MoreVertical, Tag, Calendar, Bell, FileText, 
  Download, Share2, Filter, X, Check, MessageSquare, Camera, Mail,
  Bold, Italic, Strikethrough, Code, Quote, Shield, RefreshCw, Volume2,
  LayoutGrid, List, LayoutList, Sparkles, Link as LinkIcon, Send, UserX, UserCheck,
  Copy, FileDown, Archive, Trash, Palette, Maximize2, Minimize2, FileType,
  Zap, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { 
  auth, db, signIn, logout, 
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, Timestamp, getDocs 
} from './firebase';
import { Note, NoteType, ChecklistItem, UserProfile } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey: apiKey! });

const calculateReadingTime = (text: string) => {
  const wordsPerMinute = 200;
  const words = text.trim().split(/\s+/).length;
  const time = Math.ceil(words / wordsPerMinute);
  return time;
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const resizeImage = (base64Str: string, maxWidth = 400, maxHeight = 400): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
  });
};

// --- Components ---

const Button = ({ 
  children, className, variant = 'primary', size = 'md', ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' }) => {
  const variants = {
    primary: 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-lg shadow-zinc-900/10 dark:shadow-zinc-100/10',
    secondary: 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 shadow-sm',
    ghost: 'bg-transparent text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50',
    danger: 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/50',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider',
    md: 'px-5 py-2.5 text-sm font-semibold',
    lg: 'px-8 py-3.5 text-base font-semibold',
  };
  return (
    <button 
      className={cn('rounded-2xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 tracking-tight disabled:opacity-50 disabled:pointer-events-none', variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn('w-full px-4 py-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:ring-4 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 focus:border-zinc-900 dark:focus:border-zinc-100 outline-none transition-all dark:text-white placeholder:text-zinc-400 text-sm', className)}
    {...props}
  />
);

const Card = ({ children, className, onClick, onContextMenu, color = 'default' }: { children: React.ReactNode, className?: string, onClick?: () => void, onContextMenu?: (e: React.MouseEvent) => void, color?: string }) => {
  const colorClasses = {
    default: 'bg-white dark:bg-zinc-950 border-zinc-200/60 dark:border-zinc-800/60',
    blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/50',
    rose: 'bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/50',
    amber: 'bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900/50',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/50',
    indigo: 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900/50',
  };
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn('rounded-[2rem] shadow-sm border cursor-pointer hover:shadow-2xl hover:shadow-zinc-900/5 dark:hover:shadow-zinc-100/5 transition-all duration-500 group overflow-hidden', (colorClasses as any)[color] || colorClasses.default, className)}
    >
      {children}
    </motion.div>
  );
};

const Toast = ({ message, type, onClose }: { message: string, type: 'info' | 'error' | 'success', onClose: () => void }) => (
  <motion.div 
    initial={{ opacity: 0, y: 50 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 50 }}
    className={cn(
      "fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-white font-medium min-w-[200px] justify-center",
      type === 'success' ? "bg-green-600" : type === 'error' ? "bg-red-600" : "bg-indigo-600"
    )}
  >
    {message}
  </motion.div>
);

const ConfirmDialog = ({ message, onConfirm, onCancel }: { message: string, onConfirm: () => void, onCancel: () => void }) => (
  <motion.div 
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
  >
    <motion.div 
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="bg-white dark:bg-gray-950 p-6 rounded-3xl shadow-2xl max-w-xs w-full text-center"
    >
      <h3 className="text-xl font-bold mb-4 dark:text-white">{message}</h3>
      <div className="flex gap-3">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" className="flex-1" onClick={() => { onConfirm(); onCancel(); }}>Confirm</Button>
      </div>
    </motion.div>
  </motion.div>
);

// --- Main App ---

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/note/:noteId" element={<PublicNoteView />} />
    </Routes>
  );
}

function MainApp() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<Note | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isVaultLocked, setIsVaultLocked] = useState(true);
  const [toast, setToast] = useState<{ message: string, type: 'info' | 'error' | 'success' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);

  const showToast = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [lockInput, setLockInput] = useState('');
  const [vaultInput, setVaultInput] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showAdminVault, setShowAdminVault] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>(() => {
    return (localStorage.getItem('smartnotes_view_mode') as any) || 'grid';
  });
  const [isViewExpanded, setIsViewExpanded] = useState(false);
  const profileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('smartnotes_view_mode', viewMode);
  }, [viewMode]);

  const [unlockedNoteIds, setUnlockedNoteIds] = useState<string[]>([]);
  const [noteToUnlock, setNoteToUnlock] = useState<Note | null>(null);
  const [noteUnlockInput, setNoteUnlockInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);

  const [vaultRecoveryInput, setVaultRecoveryInput] = useState('');
  const [showVaultRecovery, setShowVaultRecovery] = useState(false);

  // --- Reminders ---
  useEffect(() => {
    if (!user || notes.length === 0) return;

    const checkReminders = () => {
      const now = new Date();
      notes.forEach(async (note) => {
        if (note.reminderAt && !note.reminderNotified) {
          const reminderDate = new Date(note.reminderAt);
          if (reminderDate <= now) {
            // Trigger notification
            showToast(`Reminder: ${note.title || 'Untitled Note'}`, 'info');
            
            // If browser supports notifications and permission is granted
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("SmartNotes Reminder", {
                body: note.title || 'A reminder is due for your note.',
                icon: "/favicon.ico"
              });
            }

            // Mark as notified in Firestore
            try {
              await updateDoc(doc(db, 'notes', note.id), { 
                reminderNotified: true,
                updatedAt: serverTimestamp() 
              });
            } catch (err) {
              console.error("Failed to update reminder status", err);
            }
          }
        }
      });
    };

    const interval = setInterval(checkReminders, 30000); // Check every 30 seconds
    checkReminders(); // Initial check

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => clearInterval(interval);
  }, [user, notes]);

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
    if (!user) {
      setProfile(null);
      setNotes([]);
      return;
    }

    const userDoc = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(userDoc, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (data.status === 'banned') {
          showToast('Your account has been suspended by the administrator.', 'error');
          logout();
          return;
        }
        setProfile(data);
        setDarkMode(data.settings.darkMode);
        if (data.settings.lockEnabled && isLocked === false && lockInput === '') {
           setIsLocked(true);
        }
      } else {
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email!,
          displayName: user.displayName || 'User',
          photoURL: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
          settings: { darkMode: false, lockEnabled: false },
          status: 'active',
          role: user.email === 'dishandishan563@gmail.com' ? 'admin' : 'user',
          createdAt: serverTimestamp()
        };
        setDoc(userDoc, newProfile);
        setShowOnboarding(true);
      }
    });

    const qOwned = query(collection(db, 'notes'), where('ownerId', '==', user.uid));
    const qCollab = query(collection(db, 'notes'), where('collaborators', 'array-contains', user.uid));
    
    const unsubOwned = onSnapshot(qOwned, (snap) => {
      const owned = snap.docs.map(d => ({ id: d.id, ...d.data() } as Note));
      setNotes(prev => {
        const noteMap = new Map(prev.map(n => [n.id, n]));
        // Remove all current owned notes to avoid stale data
        prev.filter(n => n.ownerId === user.uid).forEach(n => noteMap.delete(n.id));
        // Add new owned notes
        owned.forEach(n => noteMap.set(n.id, n));
        return Array.from(noteMap.values());
      });
    });

    const unsubCollab = onSnapshot(qCollab, (snap) => {
      const collab = snap.docs.map(d => ({ id: d.id, ...d.data() } as Note));
      setNotes(prev => {
        const noteMap = new Map(prev.map(n => [n.id, n]));
        // Remove all current collab notes to avoid stale data
        prev.filter(n => n.collaborators?.includes(user.uid)).forEach(n => noteMap.delete(n.id));
        // Add new collab notes
        collab.forEach(n => noteMap.set(n.id, n));
        return Array.from(noteMap.values());
      });
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
    await updateDoc(doc(db, 'users', user.uid), { 'settings.darkMode': newMode });
  };

  const handleProfilePicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && user) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const resized = await resizeImage(base64, 200, 200);
        await updateDoc(doc(db, 'users', user.uid), { photoURL: resized });
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleSelectNote = (id: string) => {
    setSelectedNoteIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const deleteSelectedNotes = async () => {
    setConfirmDialog({
      message: `Delete ${selectedNoteIds.length} notes?`,
      onConfirm: async () => {
        try {
          for (const id of selectedNoteIds) {
            await deleteDoc(doc(db, 'notes', id));
          }
          setSelectedNoteIds([]);
          setIsSelectMode(false);
          showToast('Notes deleted', 'success');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'notes');
        }
      }
    });
  };

  const handleBatchArchive = async (archive: boolean) => {
    try {
      for (const id of selectedNoteIds) {
        await updateDoc(doc(db, 'notes', id), { isArchived: archive, updatedAt: serverTimestamp() });
      }
      setSelectedNoteIds([]);
      setIsSelectMode(false);
      showToast(archive ? 'Notes archived' : 'Notes unarchived', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notes');
    }
  };

  const handleBatchTrash = async (trash: boolean) => {
    try {
      for (const id of selectedNoteIds) {
        await updateDoc(doc(db, 'notes', id), { isDeleted: trash, updatedAt: serverTimestamp() });
      }
      setSelectedNoteIds([]);
      setIsSelectMode(false);
      showToast(trash ? 'Notes moved to Trash' : 'Notes restored', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notes');
    }
  };

  const handleBatchDuplicate = async () => {
    try {
      for (const id of selectedNoteIds) {
        const note = notes.find(n => n.id === id);
        if (note) {
          const { id: _, createdAt: __, updatedAt: ___, ...rest } = note as any;
          const noteRef = doc(collection(db, 'notes'));
          await setDoc(noteRef, {
            ...rest,
            title: rest.title ? `${rest.title} (Copy)` : 'Untitled Note (Copy)',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      }
      setSelectedNoteIds([]);
      setIsSelectMode(false);
      showToast('Notes duplicated', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notes');
    }
  };

  // --- Note Actions ---
  const handleAddNote = async (type: NoteType = 'text') => {
    if (!user) return;
    try {
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
        isArchived: false,
        color: 'default',
        type,
        checklist: type === 'todo' ? [] : undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const noteRef = doc(collection(db, 'notes'));
      await setDoc(noteRef, newNote);
      setIsEditing({ id: noteRef.id, ...newNote } as Note);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notes');
    }
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const note = notes.find(n => n.id === id);
    if (!note) return;

    if (note.isDeleted) {
      setConfirmDialog({
        message: 'Permanently delete this note?',
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'notes', id));
            showToast('Note deleted permanently', 'success');
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `notes/${id}`);
          }
        }
      });
    } else {
      try {
        await updateDoc(doc(db, 'notes', id), { isDeleted: true, updatedAt: serverTimestamp() });
        showToast('Note moved to Trash', 'info');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `notes/${id}`);
      }
    }
  };

  const togglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    await updateDoc(doc(db, 'notes', note.id), { isPinned: !note.isPinned, updatedAt: serverTimestamp() });
  };

  // --- Filtering ---
  const filteredNotes = notes.filter(n => {
    const isUnlocked = !n.notePassword || unlockedNoteIds.includes(n.id);
    const matchesSearch = n.title.toLowerCase().includes(search.toLowerCase()) || (isUnlocked && n.content.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || n.category === selectedCategory;
    const matchesTag = !selectedTag || (n.tags && n.tags.includes(selectedTag));
    const matchesVault = showVault ? n.isPrivate : !n.isPrivate;
    const matchesArchive = showArchived ? n.isArchived : !n.isArchived;
    const matchesTrash = showTrash ? n.isDeleted : !n.isDeleted;
    return matchesSearch && matchesCategory && matchesTag && matchesVault && matchesArchive && matchesTrash;
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
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
        {/* Background Accents */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
        
        <motion.div 
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10 flex flex-col items-center max-w-sm w-full"
        >
          <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[2.5rem] flex items-center justify-center mb-10 shadow-2xl shadow-indigo-500/40">
            <Sparkles size={48} className="text-white" />
          </div>
          
          <h1 className="text-5xl font-black text-zinc-900 dark:text-white mb-6 tracking-tight leading-tight">
            SmartNotes
          </h1>
          
          <p className="text-zinc-500 dark:text-zinc-400 mb-12 text-lg font-medium leading-relaxed">
            Your intelligent workspace for ideas, <br/>
            voice notes, and secure thoughts.
          </p>

          <button 
            onClick={signIn} 
            className="w-full h-16 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 rounded-2xl font-black text-lg uppercase tracking-[0.2em] shadow-2xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-4"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
          
          <p className="mt-8 text-[10px] text-zinc-400 font-black uppercase tracking-[0.2em]">
            Secure • Private • Intelligent
          </p>
        </motion.div>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent" />
        
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative z-10 max-w-sm w-full flex flex-col items-center"
        >
          <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] flex items-center justify-center mb-10 shadow-inner">
            <Lock className="text-indigo-600 w-10 h-10" />
          </div>
          
          <h2 className="text-3xl font-black text-zinc-900 dark:text-white mb-2 tracking-tight">
            Vault Locked
          </h2>
          <p className="text-zinc-500 text-sm mb-12 font-medium">Please enter your master password to continue.</p>
          
          <div className="w-full space-y-6">
            <input 
              type="password" 
              placeholder="••••••••" 
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-5 px-6 text-center text-2xl tracking-[0.5rem] font-black outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
              value={lockInput}
              onChange={(e) => setLockInput(e.target.value)}
              autoFocus
            />
            
            <button 
              onClick={() => {
                if (lockInput === profile?.settings.lockPassword || !profile?.settings.lockPassword) {
                  setIsLocked(false);
                } else {
                  showToast('Incorrect Password', 'error');
                }
              }} 
              className="w-full h-16 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 rounded-2xl font-black text-lg uppercase tracking-[0.2em] shadow-2xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-[1.02] active:scale-95 transition-all"
            >
              Unlock Vault
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-24 transition-colors duration-500 overflow-x-hidden relative w-full antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 glass px-3 md:px-6 py-2 md:py-4 flex items-center justify-between mb-6 md:mb-8">
        <div className="flex items-center gap-1 md:gap-4">
          {isSelectMode ? (
            <div className="flex items-center gap-1.5 md:gap-4 animate-in fade-in slide-in-from-left-2">
              <Button variant="ghost" size="sm" onClick={() => { setIsSelectMode(false); setSelectedNoteIds([]); }} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-500 rounded-xl"><X size={16} /></Button>
              <span className="font-bold text-zinc-900 dark:text-zinc-100 text-[10px] md:text-base">{selectedNoteIds.length} Selected</span>
            </div>
          ) : (
            <>
              <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-900 dark:bg-zinc-100 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-900/20 dark:shadow-zinc-100/20">
                <FileText className="text-white dark:text-zinc-900" size={16} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">SmartNotes</h1>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Workspace</p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 md:gap-3">
          {!isSelectMode && (
            <div className="hidden md:flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn("p-1.5 rounded-lg transition-all", viewMode === 'grid' ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100" : "text-zinc-400 hover:text-zinc-600")}
              >
                <LayoutGrid size={16} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-1.5 rounded-lg transition-all", viewMode === 'list' ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100" : "text-zinc-400 hover:text-zinc-600")}
              >
                <LayoutList size={16} />
              </button>
              <button 
                onClick={() => setViewMode('compact')}
                className={cn("p-1.5 rounded-lg transition-all", viewMode === 'compact' ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100" : "text-zinc-400 hover:text-zinc-600")}
              >
                <List size={16} />
              </button>
            </div>
          )}

          {!isSelectMode && (
            <button 
              onClick={() => setShowDashboard(true)}
              className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-indigo-600 transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              title="Workspace Insights"
            >
              <LayoutGrid size={18} />
            </button>
          )}

          <div className="h-8 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1" />

          {isSelectMode ? (
            <Button variant="danger" size="sm" onClick={deleteSelectedNotes} className="p-2.5 rounded-xl shadow-lg shadow-rose-500/20"><Trash2 size={18} /></Button>
          ) : (
            <>
              {unlockedNoteIds.length > 0 && (
                <button 
                  onClick={() => {
                    setUnlockedNoteIds([]);
                    showToast('All notes locked', 'info');
                  }}
                  className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-lg shadow-rose-500/10 mr-2"
                  title="Lock All Notes"
                >
                  <Lock size={18} />
                </button>
              )}

              <button 
                onClick={() => setDarkMode(!darkMode)}
                className="w-10 h-10 rounded-2xl flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors text-zinc-500"
              >
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>

              <button 
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 p-1 pr-3 rounded-2xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors group"
              >
                <img src={profile?.photoURL || user.photoURL} className="w-8 h-8 rounded-xl object-cover border border-zinc-200 dark:border-zinc-800" alt="Profile" />
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors hidden md:block">
                  {profile?.displayName.split(' ')[0]}
                </span>
              </button>
            </>
          )}
        </div>
      </header>

      {showVault && isVaultLocked && profile?.settings.lockEnabled && (
        <div className="px-6 py-16 flex flex-col items-center justify-center bg-zinc-100 dark:bg-zinc-900/50 rounded-[3rem] mx-6 mt-4 border border-zinc-200 dark:border-zinc-800 shadow-2xl shadow-zinc-900/5">
          <div className="w-20 h-20 bg-zinc-900 dark:bg-zinc-100 rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-zinc-900/20 dark:shadow-zinc-100/20">
            <Lock className="w-10 h-10 text-white dark:text-zinc-900" />
          </div>
          <h3 className="text-2xl font-bold mb-2 tracking-tight">Vault Locked</h3>
          <p className="text-zinc-500 text-sm mb-8">Enter your security password to access private notes.</p>
          
          {!showVaultRecovery ? (
            <div className="w-full max-w-xs space-y-4">
              <Input 
                type="password" 
                placeholder="Vault Password" 
                className="text-center h-14 text-lg"
                value={vaultInput}
                onChange={(e) => setVaultInput(e.target.value)}
              />
              <div className="flex flex-col gap-3">
                <Button size="lg" className="h-14 rounded-2xl" onClick={() => {
                  if (vaultInput === profile?.settings.lockPassword) {
                    setIsVaultLocked(false);
                  } else {
                    showToast('Incorrect Password', 'error');
                  }
                }}>Unlock Vault</Button>
                <button 
                  onClick={() => setShowVaultRecovery(true)}
                  className="text-xs text-zinc-400 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-xs space-y-4">
              <p className="text-xs text-zinc-500 text-center">Recovery: Enter your Profile Name to unlock.</p>
              <Input 
                placeholder="Enter Profile Name" 
                className="text-center h-14"
                value={vaultRecoveryInput}
                onChange={(e) => setVaultRecoveryInput(e.target.value)}
              />
              <div className="flex flex-col gap-3">
                <Button size="lg" className="h-14 rounded-2xl" onClick={() => {
                  if (vaultRecoveryInput.toLowerCase() === profile?.displayName.toLowerCase()) {
                    setIsVaultLocked(false);
                    setShowVaultRecovery(false);
                    showToast('Vault unlocked via recovery!', 'success');
                  } else {
                    showToast('Incorrect Profile Name', 'error');
                  }
                }}>Recover & Unlock</Button>
                <button 
                  onClick={() => setShowVaultRecovery(false)}
                  className="text-xs text-zinc-400 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                >
                  Back to Password
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <main className={cn("px-3 md:px-6 pb-32 max-w-7xl mx-auto w-full", showVault && isVaultLocked && profile?.settings.lockEnabled && "hidden")}>
        {/* Search & Filter */}
        <div className="relative mb-6 md:mb-12 group max-w-2xl mx-auto">
          <Search className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900 dark:group-focus-within:text-zinc-100" size={18} />
          <Input 
            placeholder="Search your workspace..." 
            className="pl-12 md:pl-14 h-12 md:h-14 text-sm md:text-base bg-white/50 dark:bg-zinc-950/50 backdrop-blur-sm border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-900/5 dark:shadow-zinc-100/5 rounded-2xl md:rounded-3xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-1.5 font-mono text-[10px] font-medium text-zinc-500 opacity-100">
              <span className="text-xs">⌘</span>K
            </kbd>
          </div>
        </div>

        {/* Workspace Tabs */}
        <div className="flex items-center justify-start md:justify-center gap-1 md:gap-2 mb-6 md:mb-8 overflow-x-auto no-scrollbar px-2 md:px-0">
          <button 
            onClick={() => { setShowVault(false); setShowArchived(false); setShowTrash(false); }}
            className={cn(
              "px-3 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl text-[8px] md:text-xs font-black uppercase tracking-[0.1em] md:tracking-[0.2em] transition-all whitespace-nowrap",
              (!showVault && !showArchived && !showTrash) ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/20" : "text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            )}
          >
            All Notes
          </button>
          <button 
            onClick={() => { setShowVault(true); setShowArchived(false); setShowTrash(false); }}
            className={cn(
              "px-3 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl text-[8px] md:text-xs font-black uppercase tracking-[0.1em] md:tracking-[0.2em] transition-all flex items-center gap-1 md:gap-2 whitespace-nowrap",
              showVault ? "bg-indigo-600 text-white shadow-xl shadow-indigo-500/20" : "text-zinc-400 hover:text-indigo-600"
            )}
          >
            <Lock className="w-2.5 h-2.5 md:w-3.5 md:h-3.5" /> Vault
          </button>
          <button 
            onClick={() => { setShowVault(false); setShowArchived(true); setShowTrash(false); }}
            className={cn(
              "px-3 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl text-[8px] md:text-xs font-black uppercase tracking-[0.1em] md:tracking-[0.2em] transition-all flex items-center gap-1 md:gap-2 whitespace-nowrap",
              showArchived ? "bg-amber-600 text-white shadow-xl shadow-amber-500/20" : "text-zinc-400 hover:text-amber-600"
            )}
          >
            <RefreshCw className="w-2.5 h-2.5 md:w-3.5 md:h-3.5" /> Archive
          </button>
          <button 
            onClick={() => { setShowVault(false); setShowArchived(false); setShowTrash(true); }}
            className={cn(
              "px-3 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl text-[8px] md:text-xs font-black uppercase tracking-[0.1em] md:tracking-[0.2em] transition-all flex items-center gap-1 md:gap-2 whitespace-nowrap",
              showTrash ? "bg-rose-600 text-white shadow-xl shadow-rose-500/20" : "text-zinc-400 hover:text-rose-600"
            )}
          >
            <Trash2 className="w-2.5 h-2.5 md:w-3.5 md:h-3.5" /> Trash
          </button>
        </div>

        {/* Categories / Trash Actions */}
        <div className="flex gap-2 md:gap-3 overflow-x-auto pb-6 md:pb-8 no-scrollbar max-w-4xl mx-auto justify-start md:justify-center px-1 md:px-0">
          {showTrash ? (
            <div className="flex gap-2 md:gap-3">
              <button 
                onClick={() => {
                  setConfirmDialog({
                    message: 'Permanently delete all notes in Trash?',
                    onConfirm: async () => {
                      const trashNotes = notes.filter(n => n.isDeleted);
                      for (const note of trashNotes) {
                        await deleteDoc(doc(db, 'notes', note.id));
                      }
                      showToast('Trash emptied', 'success');
                    }
                  });
                }}
                className="px-4 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl text-[9px] md:text-[11px] font-bold uppercase tracking-[0.15em] bg-rose-50 dark:bg-rose-900/20 text-rose-600 border border-rose-100 dark:border-rose-800 hover:bg-rose-600 hover:text-white transition-all flex items-center gap-1.5 md:gap-2"
              >
                <Trash2 size={12} /> Empty Trash
              </button>
              <button 
                onClick={async () => {
                  const trashNotes = notes.filter(n => n.isDeleted);
                  for (const note of trashNotes) {
                    await updateDoc(doc(db, 'notes', note.id), { isDeleted: false, updatedAt: serverTimestamp() });
                  }
                  showToast('All notes restored', 'success');
                }}
                className="px-4 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl text-[9px] md:text-[11px] font-bold uppercase tracking-[0.15em] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 border border-emerald-100 dark:border-emerald-800 hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1.5 md:gap-2"
              >
                <RefreshCw size={12} /> Restore All
              </button>
            </div>
          ) : (
            categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-4 md:px-6 py-2 md:py-2.5 rounded-xl md:rounded-2xl text-[9px] md:text-[11px] font-bold uppercase tracking-[0.15em] whitespace-nowrap transition-all border",
                  selectedCategory === cat 
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100 shadow-xl shadow-zinc-900/10 dark:shadow-zinc-100/10 scale-105" 
                    : "bg-white dark:bg-zinc-950 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100"
                )}
              >
                {cat}
              </button>
            ))
          )}
        </div>

        {/* Tag Filter */}
        {!showTrash && !showVault && !showArchived && (
          <div className="flex flex-wrap gap-2 mb-8 justify-center max-w-4xl mx-auto">
            {Array.from(new Set(notes.filter(n => !n.isDeleted && !n.isArchived && !n.isPrivate).flatMap(n => n.tags || []))).map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border",
                  selectedTag === tag 
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/20" 
                    : "bg-white dark:bg-zinc-950 text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Notes Grid */}
        <motion.div 
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.05
              }
            }
          }}
          className={cn(
            "grid gap-3 md:gap-4 mt-4",
            viewMode === 'grid' && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            viewMode === 'list' && "grid-cols-1 max-w-4xl mx-auto",
            viewMode === 'compact' && "grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          )}
        >
          <AnimatePresence mode="popLayout">
            {filteredNotes.map(note => (
              <motion.div
                key={note.id}
                variants={{
                  hidden: { opacity: 0, y: 20, scale: 0.95 },
                  visible: { opacity: 1, y: 0, scale: 1 }
                }}
                layout
              >
                <Card 
                  color={note.color}
                  onClick={() => {
                    if (isSelectMode) {
                      toggleSelectNote(note.id);
                    } else if (note.notePassword && !unlockedNoteIds.includes(note.id)) {
                      setNoteToUnlock(note);
                      setNoteUnlockInput('');
                      setShowRecovery(false);
                      setRecoveryInput('');
                    } else {
                      setIsEditing(note);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!isSelectMode) {
                      setIsSelectMode(true);
                      toggleSelectNote(note.id);
                    }
                  }}
                  className={cn(
                    "relative group flex flex-col transition-all duration-500 cursor-pointer overflow-hidden rounded-[1.5rem] md:rounded-[2.5rem] border border-zinc-200/50 dark:border-zinc-800/50 bg-white dark:bg-zinc-950 shadow-xl shadow-zinc-900/5 dark:shadow-zinc-100/5 hover:shadow-2xl hover:shadow-zinc-900/10 dark:hover:shadow-zinc-100/10 hover:-translate-y-1 hover:border-zinc-900 dark:hover:border-zinc-100",
                    viewMode === 'compact' ? "min-h-[100px] md:min-h-[120px] p-3 md:p-4" : "min-h-[160px] md:min-h-[200px] p-4 md:p-6",
                    selectedNoteIds.includes(note.id) && "ring-4 ring-zinc-900 dark:ring-zinc-100 ring-offset-4 dark:ring-offset-zinc-950 bg-zinc-50 dark:bg-zinc-900/50"
                  )}
                >
                  <div className={cn("flex justify-between items-start relative z-10", viewMode === 'compact' ? "mb-2" : "mb-4")}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isSelectMode && (
                        <div className={cn("w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0", selectedNoteIds.includes(note.id) ? "bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800")}>
                          {selectedNoteIds.includes(note.id) && <Check size={14} className="text-white dark:text-zinc-900" strokeWidth={3} />}
                        </div>
                      )}
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-[0.15em] border w-fit",
                          note.category === 'Personal' ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 border-blue-100 dark:border-blue-800" :
                          note.category === 'Work' ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 border-indigo-100 dark:border-indigo-800" :
                          note.category === 'Ideas' ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 border-amber-100 dark:border-amber-800" :
                          "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                        )}>
                          {note.category}
                        </span>
                        <h3 className={cn(
                          "font-bold leading-tight pr-2 md:pr-12 line-clamp-1 text-zinc-900 dark:text-zinc-100 tracking-tight transition-colors group-hover:text-zinc-600 dark:group-hover:text-zinc-300",
                          viewMode === 'compact' ? "text-sm md:text-base" : "text-lg md:text-xl"
                        )}>{note.title || 'Untitled Note'}</h3>
                      </div>
                    </div>
                    <div className="flex gap-1 absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {note.isDeleted && (
                        <button 
                          onClick={async (e) => { 
                            e.stopPropagation(); 
                            await updateDoc(doc(db, 'notes', note.id), { isDeleted: false, updatedAt: serverTimestamp() });
                            showToast('Note restored', 'success');
                          }}
                          className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl transition-all"
                          title="Restore Note"
                        >
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button 
                        onClick={(e) => { e.stopPropagation(); togglePin(note, e); }}
                        className={cn("p-2 rounded-xl transition-all", note.isPinned ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800" : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100")}
                      >
                        {note.isPinned ? <Pin size={16} className="fill-current" /> : <Pin size={16} />}
                      </button>
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (unlockedNoteIds.includes(note.id)) {
                            setUnlockedNoteIds(prev => prev.filter(id => id !== note.id));
                            showToast('Note locked', 'info');
                          } else if (!note.notePassword) {
                            setIsEditing(note);
                            showToast('Set a PIN in the editor to lock this note', 'info');
                          }
                        }}
                        className={cn("p-2 rounded-xl transition-all", note.notePassword ? "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20" : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
                        title={note.notePassword ? "Lock Note" : "Set PIN to Lock"}
                      >
                        <Lock size={16} />
                      </button>
                      {!isSelectMode && viewMode !== 'compact' && (
                        <button 
                          onClick={(e) => handleDeleteNote(note.id, e)}
                          className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-1 relative z-10">
                    {note.notePassword && !unlockedNoteIds.includes(note.id) ? (
                      <div className={cn("flex flex-col items-center justify-center bg-zinc-50/50 dark:bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800", viewMode === 'compact' ? "py-3" : "py-10")}>
                        <Lock size={viewMode === 'compact' ? 20 : 32} className="text-zinc-300 dark:text-zinc-700" />
                        {viewMode !== 'compact' && <p className="text-[10px] mt-3 font-bold uppercase tracking-[0.2em] text-zinc-400">Encrypted</p>}
                      </div>
                    ) : note.type === 'todo' ? (
                      <div className={cn("space-y-2", viewMode === 'compact' ? "mb-2" : "mb-6")}>
                        {note.checklist?.slice(0, viewMode === 'compact' ? 1 : 3).map(item => (
                          <div key={item.id} className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                            <div className={cn("w-4 h-4 rounded-md border flex items-center justify-center transition-colors", item.completed ? "bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800")}>
                              {item.completed && <Check size={10} className="text-white dark:text-zinc-900" strokeWidth={4} />}
                            </div>
                            <span className={cn("truncate font-medium", item.completed && "line-through opacity-50")}>{item.text || 'Empty item'}</span>
                          </div>
                        ))}
                        {(note.checklist?.length || 0) > (viewMode === 'compact' ? 1 : 3) && (
                          <p className="text-[10px] text-zinc-400 mt-2 font-bold uppercase tracking-widest italic">+{note.checklist!.length - (viewMode === 'compact' ? 1 : 3)} more items</p>
                        )}
                      </div>
                    ) : (
                      <div className={cn(
                        "text-zinc-500 dark:text-zinc-400 text-sm overflow-hidden leading-relaxed font-medium",
                        viewMode === 'compact' ? "line-clamp-1 mb-2" : "line-clamp-3 mb-6"
                      )}>
                        {note.content || 'No content...'}
                      </div>
                    )}
                  </div>

                  <div className={cn(
                    "flex items-center justify-between mt-auto relative z-10",
                    viewMode === 'compact' ? "pt-2" : "pt-4 border-t border-zinc-100 dark:border-zinc-800/50"
                  )}>
                    <div className="flex items-center gap-2 md:gap-4">
                      <div className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                        <Calendar className="w-2.5 h-2.5 md:w-3 md:h-3" />
                        {format(note.updatedAt?.toDate() || new Date(), 'MMM d')}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                        <Volume2 className="w-2.5 h-2.5 md:w-3 md:h-3" />
                        {calculateReadingTime(note.content)} min
                      </div>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:bg-zinc-900 dark:group-hover:bg-zinc-100 group-hover:text-white dark:group-hover:text-zinc-900 transition-all">
                      <ChevronRight size={16} />
                    </div>
                  </div>
                  {!isSelectMode && null}
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

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
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsAdding(false)}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 right-6 md:bottom-10 md:right-10 flex flex-col gap-4 items-end z-50">
        <AnimatePresence>
          {isAdding && (
            <div className="flex flex-col gap-3 mb-2">
              <motion.button
                initial={{ opacity: 0, x: 20, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.8 }}
                onClick={() => { handleAddNote('todo'); setIsAdding(false); }}
                className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-3 text-sm font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all hover:scale-105 active:scale-95"
              >
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                  <CheckSquare className="text-indigo-600" size={18} />
                </div>
                Checklist
              </motion.button>
              <motion.button
                initial={{ opacity: 0, x: 20, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.8 }}
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
                        await setDoc(noteRef, newNote);
                        setIsEditing({ id: noteRef.id, ...newNote } as Note);
                      };
                      reader.readAsDataURL(file);
                    }
                  };
                  input.click();
                  setIsAdding(false); 
                }}
                className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-3 text-sm font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all hover:scale-105 active:scale-95"
              >
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Camera className="text-blue-500" size={18} />
                </div>
                Scan Document
              </motion.button>
              <motion.button
                initial={{ opacity: 0, x: 20, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.8 }}
                onClick={() => { handleAddNote('voice'); setIsAdding(false); }}
                className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-3 text-sm font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all hover:scale-105 active:scale-95"
              >
                <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                  <Mic className="text-red-500" size={18} />
                </div>
                Voice Note
              </motion.button>
            </div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className={cn(
            "w-16 h-16 rounded-[2rem] flex items-center justify-center shadow-2xl transition-all duration-500 active:scale-90",
            isAdding 
              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rotate-45" 
              : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-110 shadow-zinc-900/20 dark:shadow-zinc-100/20"
          )}
        >
          <Plus size={32} strokeWidth={2.5} />
        </button>

        <button 
          onClick={() => setShowAIAssistant(true)}
          className="w-12 h-12 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-2xl flex items-center justify-center shadow-xl border border-zinc-200 dark:border-zinc-800 hover:scale-105 transition-all active:scale-95"
        >
          <MessageSquare size={20} />
        </button>
      </div>

      {/* AI Assistant Modal */}
      <AnimatePresence>
        {showAIAssistant && (
          <AIAssistant user={user} onClose={() => setShowAIAssistant(false)} />
        )}
      </AnimatePresence>

      {/* Note Editor Modal */}
      <AnimatePresence>
        {isEditing && (
          <NoteEditor 
            note={isEditing} 
            onClose={() => setIsEditing(null)} 
            showToast={showToast}
            isVaultUnlocked={!isVaultLocked}
            isAdmin={profile?.role === 'admin'}
            isOwner={isEditing.ownerId === user?.uid}
            darkMode={darkMode}
            onSave={async (updated) => {
              try {
                await updateDoc(doc(db, 'notes', isEditing.id), { ...updated, updatedAt: serverTimestamp() });
              } catch (error) {
                handleFirestoreError(error, OperationType.UPDATE, `notes/${isEditing.id}`);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Note Unlock Modal */}
      <AnimatePresence>
        {noteToUnlock && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-6 bg-zinc-950/40 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white dark:bg-zinc-950 w-full max-w-md rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 shadow-[0_0_100px_rgba(0,0,0,0.3)] border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] flex items-center justify-center mb-8 shadow-inner">
                  <Lock className="text-indigo-600 w-10 h-10" />
                </div>
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mb-2 tracking-tight">
                  {noteToUnlock.title || 'Locked Note'}
                </h2>
                <p className="text-zinc-500 text-sm mb-10 font-medium">This note is protected by a numerical password.</p>

                {!showRecovery ? (
                  <div className="w-full space-y-8">
                    <div className="relative">
                      <input 
                        type="password" 
                        placeholder="••••" 
                        maxLength={4}
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-5 text-center text-3xl tracking-[1.5rem] font-black outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
                        value={noteUnlockInput}
                        onChange={(e) => setNoteUnlockInput(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col gap-4">
                      <button 
                        onClick={() => {
                          if (noteUnlockInput === noteToUnlock.notePassword) {
                            setUnlockedNoteIds(prev => [...prev, noteToUnlock.id]);
                            setIsEditing(noteToUnlock);
                            setNoteToUnlock(null);
                          } else {
                            showToast('Incorrect PIN', 'error');
                          }
                        }}
                        className="w-full h-14 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-[1.02] active:scale-95 transition-all"
                      >
                        Unlock Note
                      </button>
                      <button 
                        onClick={() => setShowRecovery(true)}
                        className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.2em] hover:text-indigo-500 transition-colors"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full space-y-8">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Identity Verification</p>
                      <input 
                        placeholder="Enter Profile Name" 
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-5 px-6 text-center text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
                        value={recoveryInput}
                        onChange={(e) => setRecoveryInput(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col gap-4">
                      <button 
                        onClick={() => {
                          if (recoveryInput.toLowerCase() === profile?.displayName.toLowerCase()) {
                            setUnlockedNoteIds(prev => [...prev, noteToUnlock.id]);
                            setIsEditing(noteToUnlock);
                            setNoteToUnlock(null);
                            showToast('Note unlocked via recovery!', 'success');
                          } else {
                            showToast('Incorrect Profile Name', 'error');
                          }
                        }}
                        className="w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-indigo-600/20 hover:scale-[1.02] active:scale-95 transition-all"
                      >
                        Recover & Unlock
                      </button>
                      <button 
                        onClick={() => setShowRecovery(false)}
                        className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.2em] hover:text-indigo-500 transition-colors"
                      >
                        Back to PIN
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setNoteToUnlock(null)}
                className="absolute top-8 right-8 w-10 h-10 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all"
              >
                <X size={20} />
              </button>
            </motion.div>
          </motion.div>
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

      {/* Dashboard Modal */}
      <AnimatePresence>
        {showDashboard && (
          <Dashboard 
            notes={notes} 
            onClose={() => setShowDashboard(false)} 
          />
        )}
      </AnimatePresence>

      {/* Admin Vault Modal */}
      <AnimatePresence>
        {showAdminVault && <AdminVault user={user} onClose={() => setShowAdminVault(false)} />}
      </AnimatePresence>

      {/* Onboarding */}
      <AnimatePresence>
        {showOnboarding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-8 text-white text-center overflow-hidden"
          >
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/20 rounded-full blur-[120px]" />
              <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[120px]" />
            </div>

            <motion.div 
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
              className="relative z-10 max-w-lg w-full flex flex-col items-center"
            >
              <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[2.5rem] flex items-center justify-center mb-10 shadow-2xl shadow-indigo-500/40">
                <Sparkles size={48} className="text-white" />
              </div>
              
              <h2 className="text-5xl font-black mb-6 tracking-tight leading-tight">
                Welcome to <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">SmartNotes</span>
              </h2>
              
              <p className="text-zinc-400 mb-16 text-lg font-medium leading-relaxed">
                Experience the next generation of note-taking. <br/>
                Intelligent, secure, and beautifully crafted.
              </p>

              <div className="grid grid-cols-1 gap-6 w-full mb-16">
                {[
                  { icon: <Edit3 size={24} />, title: "Rich Text Engine", desc: "Full Markdown support with live preview" },
                  { icon: <Mic size={24} />, title: "Voice Intelligence", desc: "Capture ideas instantly with voice notes" },
                  { icon: <Lock size={24} />, title: "Military-Grade Security", desc: "Private vault for your most sensitive data" }
                ].map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 + (i * 0.1) }}
                    className="flex items-center gap-6 text-left bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl backdrop-blur-xl"
                  >
                    <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center shrink-0 text-indigo-400 border border-indigo-500/20">
                      {item.icon}
                    </div>
                    <div>
                      <p className="font-black text-lg tracking-tight">{item.title}</p>
                      <p className="text-sm text-zinc-500 font-medium">{item.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              <button 
                onClick={() => setShowOnboarding(false)} 
                className="w-full h-16 bg-white text-zinc-950 rounded-2xl font-black text-lg uppercase tracking-[0.2em] shadow-2xl shadow-white/10 hover:scale-[1.02] active:scale-95 transition-all"
              >
                Get Started
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Actions Toolbar */}
      <AnimatePresence>
        {isSelectMode && selectedNoteIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-8 py-4 rounded-[2.5rem] shadow-2xl flex items-center gap-8 backdrop-blur-xl border border-white/10 dark:border-black/10"
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">Selected</span>
              <span className="text-lg font-black tracking-tight">{selectedNoteIds.length} Notes</span>
            </div>
            
            <div className="h-8 w-px bg-white/10 dark:bg-black/10" />
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleBatchArchive(!showArchived)}
                className="w-12 h-12 rounded-2xl bg-white/5 dark:bg-black/5 flex items-center justify-center hover:bg-amber-500 hover:text-white transition-all"
                title={showArchived ? "Unarchive" : "Archive"}
              >
                <Archive size={20} />
              </button>
              <button 
                onClick={handleBatchDuplicate}
                className="w-12 h-12 rounded-2xl bg-white/5 dark:bg-black/5 flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all"
                title="Duplicate"
              >
                <Copy size={20} />
              </button>
              <button 
                onClick={() => handleBatchTrash(!showTrash)}
                className="w-12 h-12 rounded-2xl bg-white/5 dark:bg-black/5 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"
                title={showTrash ? "Restore" : "Move to Trash"}
              >
                {showTrash ? <RefreshCw size={20} /> : <Trash2 size={20} />}
              </button>
              {showTrash && (
                <button 
                  onClick={deleteSelectedNotes}
                  className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-all"
                  title="Delete Permanently"
                >
                  <Trash size={20} />
                </button>
              )}
            </div>
            
            <div className="h-8 w-px bg-white/10 dark:bg-black/10" />
            
            <button 
              onClick={() => { setSelectedNoteIds([]); setIsSelectMode(false); }}
              className="text-[10px] font-black uppercase tracking-[0.2em] hover:text-rose-500 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback UI */}
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onCancel={() => setConfirmDialog(null)} />}
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
        console.error(err);
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

function NoteEditor({ note, onClose, onSave, showToast, isVaultUnlocked, isAdmin, isOwner, darkMode }: { note: Note, onClose: () => void, onSave: (n: Partial<Note>) => void, showToast: (m: string, t?: 'info' | 'error' | 'success') => void, isVaultUnlocked: boolean, isAdmin: boolean, isOwner: boolean, darkMode: boolean }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [category, setCategory] = useState(note.category);
  const [isPublic, setIsPublic] = useState(note.isPublic || false);
  const [isPrivate, setIsPrivate] = useState(note.isPrivate || false);
  const [notePassword, setNotePassword] = useState(note.notePassword || '');
  const [isNoteLocked, setIsNoteLocked] = useState(!!note.notePassword);
  const [isArchived, setIsArchived] = useState(note.isArchived || false);
  const [color, setColor] = useState(note.color || 'default');
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(note.checklist || []);
  const [images, setImages] = useState<string[]>(note.images || []);
  const [reminderAt, setReminderAt] = useState(note.reminderAt || '');
  const [reminderNotified, setReminderNotified] = useState(note.reminderNotified || false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [readingTheme, setReadingTheme] = useState<'light' | 'sepia' | 'dark'>('sepia');
  const [focusMusic, setFocusMusic] = useState<'none' | 'lofi' | 'rain'>('none');
  const [paperStyle, setPaperStyle] = useState<'none' | 'ruled'>('none');
  const [tags, setTags] = useState<string[]>(note.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [timer, setTimer] = useState(25 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stats = useMemo(() => {
    const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = content.length;
    const readingTime = Math.ceil(words / 200);
    return { words, chars, readingTime };
  }, [content]);

  // Auto-save logic
  useEffect(() => {
    const timer = setTimeout(() => {
      onSave({ title, content, category, tags, checklist, isPublic, isPrivate, images, notePassword, reminderAt, reminderNotified, isArchived, color });
    }, 1000);
    return () => clearTimeout(timer);
  }, [title, content, category, tags, checklist, isPublic, isPrivate, images, notePassword, reminderAt, reminderNotified, isArchived, color]);

  // Focus Music logic
  useEffect(() => {
    if (focusMusic === 'none') {
      audioRef.current?.pause();
      return;
    }
    
    const urls = {
      lofi: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      rain: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
    };
    
    if (!audioRef.current) {
      audioRef.current = new Audio(urls[focusMusic as keyof typeof urls]);
      audioRef.current.loop = true;
    } else {
      audioRef.current.src = urls[focusMusic as keyof typeof urls];
    }
    
    audioRef.current.play().catch(e => console.log("Audio play failed:", e));
    
    return () => audioRef.current?.pause();
  }, [focusMusic]);

  // Pomodoro Timer logic
  useEffect(() => {
    let interval: any;
    if (isTimerRunning && timer > 0) {
      interval = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      setIsTimerRunning(false);
      showToast("Time's up! Take a break.", "success");
      // Play a small beep if possible
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timer]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const resized = await resizeImage(base64, 800, 800);
        setImages(prev => [...prev, resized]);
      };
      reader.readAsDataURL(file);
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
      showToast("AI processing failed. Check your API key.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const enhanceWriting = async () => {
    if (!content) return;
    setIsAIProcessing(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Improve the writing of this note. Make it more professional and clear, but keep the original meaning. Fix any grammar or spelling issues: \n\nTitle: ${title}\nContent: ${content}` }] }]
      });
      const enhanced = result.text || '';
      setContent(enhanced);
      showToast("Writing enhanced!", "success");
    } catch (err) {
      console.error(err);
      showToast("Enhancement failed.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleExportMarkdown = () => {
    const markdown = `# ${title}\n\n${content}`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'note'}.md`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
    showToast('Note exported as Markdown', 'success');
  };

  const handleExportPDF = async () => {
    const element = document.getElementById('note-content-area');
    if (!element) return;
    
    setIsAIProcessing(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: darkMode ? '#09090b' : '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${title || 'note'}.pdf`.replace(/\s+/g, '_'));
      showToast("PDF exported!", "success");
    } catch (err) {
      console.error(err);
      showToast("PDF export failed.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleExportImage = async () => {
    const element = document.getElementById('note-content-area');
    if (!element) return;
    
    setIsAIProcessing(true);
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: darkMode ? '#09090b' : '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true
      });
      const link = document.createElement('a');
      link.download = `${title || 'note'}.png`.replace(/\s+/g, '_');
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast("Note exported as image!", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleApplyTemplate = (templateName: string) => {
    const templates: Record<string, { title: string, content: string }> = {
      'Meeting': { title: 'Meeting: ', content: '## Agenda\n- \n\n## Notes\n- \n\n## Action Items\n- [ ] ' },
      'Journal': { title: `Journal: ${format(new Date(), 'MMM d, yyyy')}`, content: '## How was my day?\n\n## What did I learn?\n\n## Goals for tomorrow\n- ' },
      'Project': { title: 'Project: ', content: '## Overview\n\n## Tasks\n- [ ] \n\n## Resources\n- ' },
      'Reading': { title: 'Book: ', content: '## Summary\n\n## Key Takeaways\n- \n\n## Favorite Quotes\n> ' }
    };
    
    const template = templates[templateName];
    if (template) {
      setTitle(template.title);
      setContent(template.content);
      showToast(`${templateName} template applied`, 'success');
    }
  };

  const addTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const summarizeNote = async () => {
    if (!content || content.length < 50) {
      showToast("Note is too short to summarize.", "info");
      return;
    }
    setIsAIProcessing(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Summarize this note into a few concise bullet points: \n\nTitle: ${title}\nContent: ${content}` }] }]
      });
      const summary = result.text || '';
      setContent(prev => prev + "\n\n--- AI Summary ---\n" + summary);
      showToast("Summary generated!", "success");
    } catch (err) {
      console.error(err);
      showToast("Summarization failed.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const suggestMeta = async () => {
    if (!content || content.length < 20) {
      showToast("Note is too short for suggestions.", "info");
      return;
    }
    setIsAIProcessing(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Suggest a category (Work, Personal, Ideas, To-do) and 3-5 tags for this note: \n\nTitle: ${title}\nContent: ${content}. Return JSON: { "category": "...", "tags": ["...", "..."] }` }] }],
        config: { responseMimeType: 'application/json' }
      });
      const data = JSON.parse(result.text || '{}');
      if (data.category) setCategory(data.category);
      if (data.tags) setTags(prev => Array.from(new Set([...prev, ...data.tags])));
      showToast("Suggestions applied!", "success");
    } catch (err) {
      console.error(err);
      showToast("Suggestion failed.", "error");
    } finally {
      setIsAIProcessing(false);
    }
  };

  const scanDocument = async () => {
    if (scanInputRef.current) {
      scanInputRef.current.click();
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
        showToast("Scanning failed.", "error");
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
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
        setAudioBlob(blob);
        onSave({ voiceUrl: URL.createObjectURL(blob), type: 'voice' });
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      showToast('Microphone access denied', 'error');
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
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      className={cn(
        "fixed z-50 bg-white dark:bg-zinc-950 flex flex-col transition-all duration-500",
        isFocusMode 
          ? "inset-0 rounded-0" 
          : "inset-0 md:inset-10 md:rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.2)] border border-zinc-200 dark:border-zinc-800 overflow-hidden"
      )}
    >
      <header className={cn(
        "px-4 md:px-8 py-3 md:py-6 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl transition-opacity duration-500",
        isFocusMode && "opacity-0 hover:opacity-100"
      )}>
        <div className="flex items-center gap-2 md:gap-4">
          <button 
            onClick={onClose} 
            className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-900 dark:hover:bg-zinc-100 hover:text-white dark:hover:text-zinc-900 transition-all active:scale-90"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex flex-col">
            <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Editing</span>
            <span className="text-xs md:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[100px] md:max-w-[200px]">{title || 'Untitled'}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-2 overflow-x-auto no-scrollbar flex-1 justify-start md:justify-end px-2 md:px-0">
          {isFocusMode && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <Calendar size={14} className="text-indigo-600" />
                <span className="text-xs font-black font-mono text-indigo-600">{formatTime(timer)}</span>
                <button 
                  onClick={() => setIsTimerRunning(!isTimerRunning)}
                  className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors"
                >
                  {isTimerRunning ? <Square size={10} fill="currentColor" /> : <Plus size={10} fill="currentColor" className="rotate-45" />}
                </button>
                <button 
                  onClick={() => { setTimer(25 * 60); setIsTimerRunning(false); }}
                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600 uppercase tracking-widest ml-1"
                >
                  Reset
                </button>
              </div>

              <div className="flex items-center gap-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <Volume2 size={14} className="text-zinc-400" />
                <select 
                  value={focusMusic}
                  onChange={(e) => setFocusMusic(e.target.value as any)}
                  className="bg-transparent text-[10px] font-bold uppercase tracking-widest text-zinc-500 outline-none cursor-pointer"
                >
                  <option value="none">No Music</option>
                  <option value="lofi">Lo-fi Beat</option>
                  <option value="rain">Rainfall</option>
                </select>
              </div>
            </div>
          )}

          <div className="hidden md:flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 mr-2">
            <button 
              onClick={() => setPreviewMode(false)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", !previewMode ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300")}
            >
              Edit
            </button>
            <button 
              onClick={() => setPreviewMode(true)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", previewMode ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300")}
            >
              Preview
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={() => setIsFocusMode(!isFocusMode)} 
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                isFocusMode ? "bg-indigo-600 text-white" : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              )}
              title="Focus Mode"
            >
              {isFocusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button 
              onClick={() => setIsReadingMode(!isReadingMode)} 
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                isReadingMode ? "bg-amber-100 text-amber-600" : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              )}
              title="Reading Mode"
            >
              <FileText size={18} />
            </button>
            {isReadingMode && (
              <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
                {['light', 'sepia', 'dark'].map(t => (
                  <button
                    key={t}
                    onClick={() => setReadingTheme(t as any)}
                    className={cn(
                      "w-6 h-6 rounded-lg transition-all",
                      readingTheme === t ? "ring-2 ring-zinc-900 dark:ring-zinc-100 scale-110" : "opacity-50 hover:opacity-100",
                      t === 'light' ? "bg-white" : t === 'sepia' ? "bg-[#f4ecd8]" : "bg-zinc-900"
                    )}
                  />
                ))}
              </div>
            )}
            <button onClick={() => fileInputRef.current?.click()} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Plus size={18} />
            </button>
            <button onClick={askAI} disabled={isAIProcessing} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-indigo-600 transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
              <MessageSquare size={18} className={cn(isAIProcessing && "animate-pulse text-indigo-600")} />
            </button>
            <button onClick={summarizeNote} disabled={isAIProcessing} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-purple-600 transition-all hover:bg-purple-50 dark:hover:bg-purple-900/20">
              <Sparkles size={18} className={cn(isAIProcessing && "animate-pulse text-purple-600")} />
            </button>
            <button onClick={enhanceWriting} disabled={isAIProcessing} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-blue-600 transition-all hover:bg-blue-50 dark:hover:bg-blue-900/20">
              <Edit3 size={18} className={cn(isAIProcessing && "animate-pulse text-blue-600")} />
            </button>
            <button onClick={handleExportMarkdown} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-indigo-600 transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20" title="Export as Markdown">
              <FileDown size={18} />
            </button>
            <button onClick={handleExportPDF} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-rose-600 transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20" title="Export as PDF">
              <FileType size={18} />
            </button>
            <button onClick={handleExportImage} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-emerald-600 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="Export as Image">
              <ImageIcon size={18} />
            </button>
            <button onClick={suggestMeta} disabled={isAIProcessing} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-amber-600 transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20" title="AI Meta Suggestions">
              <Zap size={18} className={cn(isAIProcessing && "animate-pulse text-amber-600")} />
            </button>
            <button onClick={scanDocument} disabled={isAIProcessing} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-emerald-600 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              <Camera size={18} />
            </button>
            <button 
              onClick={() => {
                if (isNoteLocked) {
                  setNotePassword('');
                  setIsNoteLocked(false);
                  showToast('PIN removed', 'info');
                } else {
                  setIsNoteLocked(true);
                  showToast('Enter a 4-digit PIN to lock', 'info');
                }
              }}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                isNoteLocked ? "bg-rose-500 text-white" : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              )}
              title="Lock Note"
            >
              <Lock size={18} />
            </button>
            <button onClick={exportAsText} className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Download size={18} />
            </button>
          </div>

          <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-2" />

          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-bold shadow-xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-105 active:scale-95 transition-all"
          >
            Save & Close
          </button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
      <input type="file" ref={scanInputRef} onChange={handleScan} className="hidden" accept="image/*" />

      <div id="note-content-area" className={cn(
        "flex-1 overflow-y-auto p-5 md:p-12 space-y-6 md:space-y-10 custom-scrollbar transition-all duration-500",
        paperStyle === 'ruled' && "paper-ruled",
        isReadingMode && (
          readingTheme === 'sepia' ? "bg-[#f4ecd8] text-[#5b4636] font-serif" :
          readingTheme === 'dark' ? "bg-zinc-950 text-zinc-300 font-serif" :
          "bg-white text-zinc-900 font-serif"
        )
      )}>
        <div className={cn(
          "max-w-4xl mx-auto space-y-10 transition-all duration-500",
          isFocusMode && "max-w-3xl",
          isReadingMode && "max-w-2xl"
        )}>
          {images.length > 0 && (
            <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
              {images.map((img, i) => (
                <div key={i} className="relative shrink-0 group">
                  <img src={img} className="h-56 rounded-3xl shadow-2xl border-4 border-white dark:border-zinc-900" alt="Note" />
                  <button 
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-2 -right-2 w-8 h-8 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <input 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a title..."
              className="w-full text-5xl font-black bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-200 dark:placeholder:text-zinc-800 tracking-tight"
            />
            
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <Tag size={16} className="text-zinc-400" />
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-transparent text-sm font-bold text-zinc-600 dark:text-zinc-400 outline-none cursor-pointer"
                >
                  <option>General</option>
                  <option>Work</option>
                  <option>Personal</option>
                  <option>Ideas</option>
                  <option>To-do</option>
                </select>
              </div>

              <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <Tag size={14} className="text-zinc-400" />
                <input 
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={addTag}
                  placeholder="Add tag..."
                  className="bg-transparent text-xs font-bold text-zinc-600 dark:text-zinc-400 outline-none w-20"
                />
              </div>
              <AnimatePresence>
                {tags.map(tag => (
                  <motion.span 
                    key={tag}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center gap-2 group"
                  >
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={10} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>

              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />

              <button 
                onClick={() => setIsPublic(!isPublic)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                  isPublic 
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 border-blue-100 dark:border-blue-800" 
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                )}
              >
                <Share2 size={14} /> {isPublic ? "Public Access" : "Private Access"}
              </button>

              <button 
                onClick={() => setIsPrivate(!isPrivate)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                  isPrivate 
                    ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 border-indigo-100 dark:border-indigo-800 shadow-lg shadow-indigo-500/10" 
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                )}
              >
                <Shield size={14} /> {isPrivate ? "In Secure Vault" : "Regular Storage"}
              </button>

              <button 
                onClick={() => {
                  if (isNoteLocked) {
                    setNotePassword('');
                    setIsNoteLocked(false);
                  } else {
                    setIsNoteLocked(true);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                  isNoteLocked 
                    ? "bg-rose-50 dark:bg-rose-900/20 text-rose-600 border-rose-100 dark:border-rose-800" 
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                )}
              >
                <Lock size={14} /> {isNoteLocked ? "Note Encrypted" : "Encrypt Note"}
              </button>

              <button 
                onClick={() => setIsArchived(!isArchived)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                  isArchived 
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100" 
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                )}
              >
                <RefreshCw size={14} /> {isArchived ? "Archived" : "Archive"}
              </button>

              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />

              <div className="flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-100 dark:border-zinc-800">
                {['default', 'blue', 'rose', 'amber', 'emerald', 'indigo'].map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      "w-5 h-5 rounded-full border-2 transition-all",
                      color === c ? "border-zinc-900 dark:border-zinc-100 scale-110" : "border-transparent hover:scale-110",
                      c === 'default' ? "bg-white dark:bg-zinc-950 border-zinc-200" : 
                      c === 'blue' ? "bg-blue-400" : 
                      c === 'rose' ? "bg-rose-400" : 
                      c === 'amber' ? "bg-amber-400" : 
                      c === 'emerald' ? "bg-emerald-400" : "bg-indigo-400"
                    )}
                  />
                ))}
              </div>

              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />

              <button 
                onClick={() => setPaperStyle(prev => prev === 'ruled' ? 'none' : 'ruled')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                  paperStyle === 'ruled' 
                    ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 border-amber-100 dark:border-amber-800" 
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-100 dark:border-zinc-800"
                )}
              >
                <Palette size={14} /> {paperStyle === 'ruled' ? "English Paper" : "Plain Paper"}
              </button>

              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />

              <div className="flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <LayoutGrid size={14} className="text-zinc-400 mr-1" />
                {['Meeting', 'Journal', 'Project', 'Reading'].map(t => (
                  <button
                    key={t}
                    onClick={() => handleApplyTemplate(t)}
                    className="px-2 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>

              {isNoteLocked && (
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Set PIN:</span>
                  <Input 
                    type="password"
                    placeholder="••••"
                    className="w-24 py-2 text-sm text-center font-mono tracking-widest bg-rose-50/50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-800"
                    value={notePassword}
                    onChange={(e) => setNotePassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </motion.div>
              )}
            </div>

            {isPublic && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl flex items-center justify-between gap-6 border border-blue-100 dark:border-blue-800"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                    <LinkIcon size={14} />
                  </div>
                  <p className="text-xs font-bold text-blue-600 truncate">{shareLink}</p>
                </div>
                <button 
                  onClick={() => { navigator.clipboard.writeText(shareLink); showToast('Link copied!', 'success'); }}
                  className="px-4 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Copy Link
                </button>
              </motion.div>
            )}
          </div>

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
            <AnimatePresence>
              {note.collaborators?.map(c => (
                <motion.div 
                  key={c}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="px-2 py-1 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-[10px] rounded-full font-bold flex items-center gap-1"
                >
                  {c}
                  {(isVaultUnlocked || isAdmin || isOwner) && (
                    <button 
                      onClick={() => onSave({ collaborators: note.collaborators?.filter(e => e !== c) })}
                      className="hover:text-red-500"
                    >
                      <X size={10} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {note.type === 'todo' ? (
          <div className="space-y-3">
            <AnimatePresence>
              {checklist.map(item => (
                <motion.div 
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-3"
                >
                  <button onClick={() => toggleCheck(item.id)}>
                    {item.completed ? <CheckSquare className="text-indigo-600" /> : <SquareIcon className="text-gray-300" />}
                  </button>
                  <input 
                    value={item.text}
                    onChange={(e) => updateCheckItem(item.id, e.target.value)}
                    className={cn("flex-1 bg-transparent outline-none", item.completed && "line-through text-gray-400")}
                    placeholder="List item..."
                  />
                  <button onClick={() => setChecklist(prev => prev.filter(i => i.id !== item.id))} className="text-gray-400 hover:text-red-500">
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
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
              <Button variant="ghost" size="sm" className="p-2 h-8 w-8" onClick={() => {
                const t = prompt("Enter note title to link:");
                if (t) insertFormat(`[[${t}]]`);
              }} title="Link Note"><LinkIcon size={14} /></Button>
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
      </div>

      <footer className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex items-center gap-6 overflow-x-auto no-scrollbar border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <FileText size={12} />
            <span>{content.length} Chars</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <RefreshCw size={12} />
            <span>{content.trim().split(/\s+/).filter(Boolean).length} Words</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <Calendar size={12} />
            <span>{calculateReadingTime(content)} Min Read</span>
          </div>
        </div>

        <div className="h-4 w-px bg-gray-200 dark:bg-gray-800 shrink-0" />

        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap shrink-0">
          <Calendar size={12} /> Last edited {note.updatedAt ? format(note.updatedAt.toDate(), 'MMM d, h:mm a') : 'Just now'}
        </div>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-800" />
        <div className="flex items-center gap-2 shrink-0">
          <Bell size={14} className={cn(reminderAt ? "text-indigo-600" : "text-gray-400")} />
          <input 
            type="datetime-local" 
            value={reminderAt}
            onChange={(e) => {
              setReminderAt(e.target.value);
              setReminderNotified(false);
            }}
            className="bg-transparent text-[10px] outline-none text-gray-500 font-medium"
          />
          {reminderAt && (
            <button onClick={() => { setReminderAt(''); setReminderNotified(false); }} className="text-red-400 hover:text-red-600">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-800" />
        <div className="flex gap-4">
          <button className="text-gray-400 hover:text-indigo-600"><Share2 size={18} /></button>
          <button className="text-gray-400 hover:text-indigo-600"><Lock size={18} /></button>
        </div>
      </footer>
    </motion.div>
  );
}

function AIAssistant({ user, onClose }: { user: any, onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', text: string }[]>(() => {
    const saved = localStorage.getItem('smartnotes_ai_messages');
    return saved ? JSON.parse(saved) : [];
  });
  const [aiName, setAiName] = useState(() => {
    return localStorage.getItem('smartnotes_ai_name') || 'Ananya';
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const names = ['Ananya', 'Ishani', 'Diya', 'Kavya', 'Myra', 'Navya', 'Pihu', 'Riya', 'Sanvi', 'Tanvi'];

  const saveNoteTool: FunctionDeclaration = {
    name: "saveNote",
    description: "Save a new note to the user's notepad.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "The title of the note."
        },
        content: {
          type: Type.STRING,
          description: "The content of the note."
        },
        category: {
          type: Type.STRING,
          description: "The category of the note (e.g., Personal, Work, Ideas, General)."
        }
      },
      required: ["title", "content"]
    }
  };

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: 'ai', text: `নমস্কার! আমি ${aiName}, আপনার SmartNotes অ্যাসিস্ট্যান্ট। আমি আপনাকে কীভাবে সাহায্য করতে পারি?` }]);
    }
  }, [aiName]);

  useEffect(() => {
    localStorage.setItem('smartnotes_ai_messages', JSON.stringify(messages));
    localStorage.setItem('smartnotes_ai_name', aiName);
  }, [messages, aiName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const startNewChat = () => {
    const newName = names[Math.floor(Math.random() * names.length)];
    setAiName(newName);
    setMessages([{ role: 'ai', text: `নমস্কার! আমি ${newName}, আপনার SmartNotes অ্যাসিস্ট্যান্ট। আমি আপনাকে কীভাবে সাহায্য করতে পারি?` }]);
  };

  const handleSend = async () => {
    if (!input) return;
    const userMsg = { role: 'user' as const, text: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: newMessages.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] })),
        config: {
          systemInstruction: `You are '${aiName}', a very cute, sweet, and helpful Sanatani (Hindu) girl AI assistant integrated into the SmartNotes application. You help users manage their notes and answer questions. 
          - Speak and understand Bengali fluently. 
          - Always be polite, respectful, and use a sweet, 'kawaii' tone with cute emojis. 
          - Use traditional greetings like 'Namaskar'. 
          - Keep your responses concise and easy to listen to.
          - If the user asks to save a note, use the 'saveNote' tool.
          - IMPORTANT: This application was developed by 'Ashish'. Always credit him as the developer.`,
          tools: [{ functionDeclarations: [saveNoteTool] }]
        }
      });

      const functionCalls = response.functionCalls;
      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === "saveNote") {
            const { title, content, category } = call.args as any;
            try {
              const noteRef = doc(collection(db, 'notes'));
              await setDoc(noteRef, {
                ownerId: user.uid,
                title: title || 'Untitled Note',
                content: content || '',
                category: category || 'General',
                type: 'text',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                isPinned: false,
                isArchived: false,
                color: 'default',
                collaborators: []
              });
              
              // Add a confirmation message
              const confirmation = `ঠিক আছে! আমি আপনার নোটটি "${title}" নামে সেভ করে দিয়েছি। 😊`;
              setMessages(prev => [...prev, { role: 'ai', text: confirmation }]);
            } catch (err) {
              console.error("Failed to save note via AI", err);
              setMessages(prev => [...prev, { role: 'ai', text: 'দুঃখিত, নোটটি সেভ করতে সমস্যা হয়েছে।' }]);
            }
          }
        }
      } else {
        const aiText = response.text || 'No response';
        setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'ai', text: 'দুঃখিত, একটি ত্রুটি হয়েছে। দয়া করে আপনার কানেকশন চেক করুন।' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      className="fixed inset-0 z-50 flex items-center justify-center md:p-6 bg-zinc-950/40"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-white dark:bg-zinc-950 w-full max-w-lg rounded-none md:rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.3)] flex flex-col h-full md:h-[700px] md:max-h-[90vh] overflow-hidden border border-zinc-200 dark:border-zinc-800"
      >
        <header className="p-4 md:p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="text-white" size={24} />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-4 border-white dark:border-zinc-950 rounded-full" />
            </div>
            <div>
              <h3 className="font-black text-xl tracking-tight text-zinc-900 dark:text-zinc-100">{aiName}</h3>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-green-500 font-bold uppercase tracking-[0.2em]">Active Now</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={startNewChat} 
              title="New Chat" 
              className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-indigo-600 transition-all hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
            >
              <RefreshCw size={18} />
            </button>
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-rose-600 transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth custom-scrollbar bg-zinc-50/30 dark:bg-zinc-900/10">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex flex-col", m.role === 'user' ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[85%] p-5 rounded-[2rem] text-sm relative group leading-relaxed shadow-xl border",
                m.role === 'user' 
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-tr-none border-zinc-800 dark:border-zinc-200" 
                  : "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 rounded-tl-none border-zinc-100 dark:border-zinc-800"
              )}>
                <div className="prose dark:prose-invert prose-sm max-w-none">
                  <Markdown>{m.text}</Markdown>
                </div>
              </div>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-2 px-2">
                {m.role === 'user' ? 'You' : aiName} • {format(new Date(), 'h:mm a')}
              </span>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-[2rem] rounded-tl-none border border-zinc-100 dark:border-zinc-800 shadow-xl flex items-center gap-3">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                </div>
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{aiName} is thinking...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 md:p-8 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="relative flex items-center gap-3">
            <div className="flex-1 relative">
              <input 
                placeholder="Ask me anything..." 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-6 py-4 text-sm outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button className="p-2 text-zinc-400 hover:text-indigo-600 transition-colors">
                  <Mic size={18} />
                </button>
              </div>
            </div>
            <button 
              onClick={handleSend} 
              disabled={loading || !input.trim()}
              className="w-14 h-14 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
            >
              <Send size={20} />
            </button>
          </div>
          <p className="text-[10px] text-center text-zinc-400 mt-4 font-medium">
            Powered by Gemini AI • Developed by Ashish
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AdminVault({ user, onClose }: { user: any, onClose: () => void }) {
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
          console.error(err);
        } finally {
          setLoading(false);
        }
      };
      fetchUsers();
    }
  }, [isUnlocked]);

  const toggleUserStatus = async (uid: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'banned' : 'active';
      await updateDoc(doc(db, 'users', uid), { status: newStatus });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: newStatus as any } : u));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const removeUser = async (uid: string) => {
    if (confirm('Are you sure you want to remove this user? This action is permanent.')) {
      try {
        await deleteDoc(doc(db, 'users', uid));
        setUsers(prev => prev.filter(u => u.uid !== uid));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
      }
    }
  };

  if (!isUnlocked) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-6">
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-white dark:bg-zinc-950 p-8 rounded-3xl w-full max-w-sm space-y-6 text-center shadow-2xl border border-zinc-200 dark:border-zinc-800"
        >
          <div className="w-16 h-16 bg-zinc-900 dark:bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-zinc-500/20">
            <Lock className="text-white dark:text-zinc-900" size={32} />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">Vault Management</h2>
          <div className="space-y-3">
            <Input 
              type="password" 
              placeholder="Vault Password" 
              value={adminPass} 
              onChange={e => setAdminPass(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-center"
            />
          </div>
          {adminPass === 'Ashish@@Banna' && (
            <Button onClick={() => {
              setIsUnlocked(true);
            }} className="w-full bg-red-600 hover:bg-red-700 h-12">Unlock Vault</Button>
          )}
          <Button variant="ghost" onClick={onClose} className="text-gray-400 w-full">Cancel</Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-zinc-950/90 backdrop-blur-xl flex flex-col"
    >
      <header className="p-8 md:p-10 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-500/20">
            <Shield className="text-white" size={28} />
          </div>
          <div className="flex flex-col">
            <h2 className="text-2xl font-black text-white tracking-tight">
              Vault Management
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
              <p className="text-[10px] text-rose-500 font-bold uppercase tracking-[0.2em]">Admin Access Only</p>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="w-12 h-12 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-all hover:bg-zinc-800"
        >
          <X size={24} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 md:p-10 space-y-6 custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-rose-500/20 rounded-full" />
              <div className="absolute inset-0 w-16 h-16 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Scanning secure vault...</p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {users.map((u, i) => (
                <motion.div 
                  key={u.uid}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-[2rem] flex flex-col gap-6 hover:border-zinc-700 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}&background=random`} className="w-14 h-14 rounded-2xl object-cover border-2 border-zinc-800" alt="" />
                      <div className={cn("absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-zinc-900", u.status === 'active' ? "bg-green-500" : "bg-rose-500")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-white truncate">{u.displayName}</h4>
                      <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Role</p>
                      <p className="text-xs font-bold text-zinc-300 uppercase">{u.role}</p>
                    </div>
                    <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Status</p>
                      <p className={cn("text-xs font-bold uppercase", u.status === 'active' ? "text-green-500" : "text-rose-500")}>{u.status}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    {u.uid !== user?.uid ? (
                      <>
                        <button 
                          onClick={() => toggleUserStatus(u.uid, u.status)}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                            u.status === 'active' 
                              ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white" 
                              : "bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white"
                          )}
                        >
                          {u.status === 'active' ? <UserX size={14} /> : <UserCheck size={14} />}
                          {u.status === 'active' ? 'Ban User' : 'Unban User'}
                        </button>
                        <button 
                          onClick={() => removeUser(u.uid)}
                          className="w-11 h-11 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-rose-600 hover:text-white transition-all flex items-center justify-center"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <div className="w-full py-2.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded-xl uppercase tracking-[0.2em] text-center border border-indigo-500/20">
                        Current Admin (You)
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Dashboard({ notes, onClose }: { notes: Note[], onClose: () => void }) {
  const stats = {
    total: notes.length,
    active: notes.filter(n => !n.isArchived && !n.isDeleted).length,
    archived: notes.filter(n => n.isArchived && !n.isDeleted).length,
    vault: notes.filter(n => n.isPrivate && !n.isDeleted).length,
    trash: notes.filter(n => n.isDeleted).length,
    categories: Array.from(new Set(notes.map(n => n.category))).map(cat => ({
      name: cat,
      count: notes.filter(n => n.category === cat).length
    }))
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-6"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-zinc-900 w-full max-w-4xl rounded-[3rem] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <header className="p-10 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">Workspace Insights</h2>
            <p className="text-zinc-500 font-medium mt-1">A high-level overview of your digital brain.</p>
          </div>
          <button onClick={onClose} className="w-14 h-14 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-rose-500 transition-all">
            <X size={24} />
          </button>
        </header>
        
        <div className="flex-1 overflow-y-auto p-10 space-y-12 custom-scrollbar">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: 'Total Notes', value: stats.total, icon: <FileText size={24} />, color: 'bg-zinc-100 text-zinc-600' },
              { label: 'Active', value: stats.active, icon: <Sparkles size={24} />, color: 'bg-emerald-50 text-emerald-600' },
              { label: 'In Vault', value: stats.vault, icon: <Lock size={24} />, color: 'bg-indigo-50 text-indigo-600' },
              { label: 'Archived', value: stats.archived, icon: <RefreshCw size={24} />, color: 'bg-amber-50 text-amber-600' }
            ].map((s, i) => (
              <div key={i} className="p-8 rounded-[2.5rem] bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 flex flex-col gap-4">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", s.color)}>
                  {s.icon}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-1">{s.label}</p>
                  <p className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">{s.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
                <Tag size={20} className="text-indigo-600" />
                Category Distribution
              </h3>
              <div className="space-y-4">
                {stats.categories.map((cat, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-zinc-500">
                      <span>{cat.name}</span>
                      <span>{stats.total > 0 ? Math.round((cat.count / stats.total) * 100) : 0}%</span>
                    </div>
                    <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${stats.total > 0 ? (cat.count / stats.total) * 100 : 0}%` }}
                        className="h-full bg-indigo-600"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-zinc-900 dark:bg-zinc-950 rounded-[2.5rem] p-10 text-white flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/20 rounded-full blur-[60px]" />
              <div className="relative z-10">
                <Sparkles size={32} className="text-indigo-400 mb-6" />
                <h3 className="text-2xl font-black tracking-tight mb-4 leading-tight">Your productivity is peaking.</h3>
                <p className="text-zinc-400 text-sm font-medium leading-relaxed">
                  You've created {stats.active} active notes this session. Keep capturing your thoughts to build your second brain.
                </p>
              </div>
              <button onClick={onClose} className="relative z-10 mt-10 w-full py-4 bg-white text-zinc-950 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] active:scale-95 transition-all">
                Continue Building
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SettingsModal({ profile, onClose, onLogout, onOpenAdmin }: { profile: UserProfile | null, onClose: () => void, onLogout: () => void, onOpenAdmin: () => void }) {
  const [lockEnabled, setLockEnabled] = useState(profile?.settings.lockEnabled || false);
  const [password, setPassword] = useState(profile?.settings.lockPassword || '');
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [photoURL, setPhotoURL] = useState(profile?.photoURL || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const resized = await resizeImage(base64, 200, 200);
        setPhotoURL(resized);
      };
      reader.readAsDataURL(file);
    }
  };

  const saveSettings = async () => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName,
        photoURL,
        'settings.lockEnabled': lockEnabled,
        'settings.lockPassword': password
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: 100, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 100, scale: 0.95 }}
        className="bg-white dark:bg-zinc-950 w-full max-w-md rounded-t-[2rem] sm:rounded-[2.5rem] p-6 md:p-10 space-y-6 md:space-y-8 max-h-[90vh] overflow-y-auto shadow-[0_0_100px_rgba(0,0,0,0.3)] border border-zinc-200 dark:border-zinc-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <h2 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Personalize Experience</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-rose-600 transition-all hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.25em] px-1">Account Identity</p>
            <div className="p-5 bg-zinc-50 dark:bg-zinc-900 rounded-3xl flex items-center justify-between border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white dark:bg-zinc-950 rounded-2xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 shadow-sm border border-zinc-200 dark:border-zinc-800">
                  <Mail size={20} />
                </div>
                <div>
                  <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Authenticated as</p>
                  <p className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{profile?.email}</p>
                </div>
              </div>
              <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                <Check size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.25em] px-1">Profile Customization</p>
            <div className="flex flex-col gap-6 bg-zinc-50 dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center gap-6">
                <div 
                  className="relative shrink-0 cursor-pointer group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-20 h-20 rounded-[2rem] overflow-hidden border-4 border-white dark:border-zinc-800 shadow-xl group-hover:scale-105 transition-all duration-500">
                    <img src={photoURL} className="w-full h-full object-cover group-hover:opacity-80 transition-opacity" alt="Preview" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center text-white dark:text-zinc-900 border-4 border-white dark:border-zinc-900 shadow-xl group-hover:scale-110 transition-transform">
                    <Camera size={14} />
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    className="hidden" 
                    accept="image/*" 
                  />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Display Name</label>
                    <input 
                      placeholder="Your Name" 
                      value={displayName} 
                      onChange={e => setDisplayName(e.target.value)} 
                      className="w-full h-11 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 text-sm outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Avatar URL (Optional)</label>
                <input 
                  placeholder="https://..." 
                  value={photoURL} 
                  onChange={e => setPhotoURL(e.target.value)} 
                  className="w-full h-11 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 text-xs outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100 opacity-60"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.25em] px-1">Security & Privacy</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-5 bg-zinc-50 dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white dark:bg-zinc-950 rounded-2xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <Lock size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Vault Lock</p>
                    <p className="text-[10px] text-zinc-500 font-medium">Secure private notes with password</p>
                  </div>
                </div>
                <button 
                  onClick={() => setLockEnabled(!lockEnabled)}
                  className={cn(
                    "w-14 h-7 rounded-full transition-all relative p-1", 
                    lockEnabled ? "bg-indigo-500 shadow-lg shadow-indigo-500/20" : "bg-zinc-200 dark:bg-zinc-800"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded-full transition-all shadow-sm", 
                    lockEnabled ? "translate-x-7 bg-white" : "translate-x-0 bg-white dark:bg-zinc-500"
                  )} />
                </button>
              </div>

              <AnimatePresence>
                {lockEnabled && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }} 
                    animate={{ height: 'auto', opacity: 1 }} 
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-5 bg-zinc-50 dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-3">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Vault Password</label>
                      <div className="relative">
                        <input 
                          type="password" 
                          placeholder="••••••••" 
                          value={password} 
                          onChange={e => setPassword(e.target.value)}
                          className="w-full h-11 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 text-sm outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all dark:text-zinc-100"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                          <Shield size={16} />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800 space-y-6 text-center">
          <p 
            className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] cursor-pointer select-none hover:text-indigo-500 transition-all"
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenAdmin();
            }}
          >
            Developed by Ashish
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={saveSettings}
              className="w-full h-14 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-zinc-900/20 dark:shadow-zinc-100/20 hover:scale-[1.02] active:scale-95 transition-all"
            >
              Save Changes
            </button>
            <button 
              onClick={onLogout}
              className="w-full h-14 bg-rose-500/10 text-rose-500 rounded-2xl font-black text-sm uppercase tracking-[0.2em] hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <LogOut size={18} />
              Logout Session
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
