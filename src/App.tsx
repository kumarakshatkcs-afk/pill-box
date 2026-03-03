import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Clock, 
  Cpu, 
  FileCode, 
  AlertCircle, 
  CheckCircle2, 
  Activity, 
  RefreshCw,
  Terminal,
  Bell,
  Settings,
  Download,
  Image as ImageIcon,
  X,
  MessageSquare,
  Send,
  User,
  Bot,
  Volume2,
  VolumeX,
  ShieldCheck,
  LayoutDashboard,
  History,
  Info,
  Trash2,
  Mic,
  BarChart3,
  Package,
  Stethoscope,
  Heart,
  Smartphone,
  Phone,
  ShieldAlert,
  Thermometer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { identifyPill, getChatResponse } from './services/geminiService';
import { PYTHON_CODE, ARDUINO_CODE } from './constants';
import { db, auth } from './services/firebase';
import { ref, onValue, set, update } from 'firebase/database';
import { 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PillResult {
  name: string;
  description: string;
  confidence: number;
  match: string;
}

interface ScheduleItem {
  id: string;
  pillName: string;
  time: string;
  slot: number;
  language?: string;
  relation?: string;
  status?: 'pending' | 'taken' | 'missed';
  stock?: number;
  sideEffects?: string[];
}

interface SymptomLog {
  id: string;
  timestamp: Date;
  symptom: string;
  severity: 'low' | 'medium' | 'high';
}

interface Notification {
  id: string;
  message: string;
  timestamp: Date;
  type: 'info' | 'alert';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function App() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pillResult, setPillResult] = useState<PillResult | null>(null);
  const [logs, setLogs] = useState<string[]>(["[SYSTEM] Initializing AI Pillbox...", "[SYSTEM] Waiting for image upload..."]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [dueSlot, setDueSlot] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hello! I'm your AI Medication Assistant. How can I help you with your pills or schedule today?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'code' | 'history' | 'setup' | 'analytics' | 'inventory'>('dashboard');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const [symptoms, setSymptoms] = useState<SymptomLog[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [vitals, setVitals] = useState({ temp: 98.6, heartRate: 72 });

  useEffect(() => {
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        setUser(user);
        if (user) {
          addNotification(`Welcome back, ${user.phoneNumber}`, 'info');
        }
      });
      return () => unsubscribe();
    }
  }, []);

  const setupRecaptcha = () => {
    if (!auth) return;
    if (!(window as any).recaptchaVerifier) {
      (window as any).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': () => {}
      });
    }
  };

  const handleSendOtp = async () => {
    if (!auth) return;
    try {
      setupRecaptcha();
      const verifier = (window as any).recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, phoneNumber, verifier);
      setConfirmationResult(result);
      addNotification("OTP sent successfully", 'info');
    } catch (error: any) {
      console.error(error);
      addNotification("Failed to send OTP: " + error.message, 'alert');
    }
  };

  const handleVerifyOtp = async () => {
    try {
      await confirmationResult.confirm(otp);
      setIsLoginModalOpen(false);
      addNotification("Login successful", 'info');
    } catch (error: any) {
      console.error(error);
      addNotification("Invalid OTP", 'alert');
    }
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      addNotification("Logged out", 'info');
    }
  };

  const isFirebaseConfigured = !!db;

  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => {
    const saved = localStorage.getItem('pillbox_schedule');
    return saved ? JSON.parse(saved) : [
      { id: '1', pillName: 'Aspirin', time: '10:00', slot: 1, language: 'English', relation: 'Self', status: 'pending' },
      { id: '2', pillName: 'Vitamin C', time: '08:00', slot: 2, language: 'English', relation: 'Self', status: 'pending' },
    ];
  });

  const [caregiverContact, setCaregiverContact] = useState(() => {
    const saved = localStorage.getItem('pillbox_caregiver');
    return saved ? JSON.parse(saved) : { email: '', phone: '' };
  });

  // Firebase Listeners
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;

    const scheduleRef = ref(db, 'schedule');
    const unsubscribeSchedule = onValue(scheduleRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setSchedule(Object.values(data));
      }
    });

    const caregiverRef = ref(db, 'caregiver');
    const unsubscribeCaregiver = onValue(caregiverRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setCaregiverContact(data);
      }
    });

    return () => {
      unsubscribeSchedule();
      unsubscribeCaregiver();
    };
  }, [isFirebaseConfigured]);

  // Persist data locally and to Firebase
  useEffect(() => {
    localStorage.setItem('pillbox_schedule', JSON.stringify(schedule));
    if (isFirebaseConfigured && db) {
      const scheduleObj = schedule.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});
      set(ref(db, 'schedule'), scheduleObj);
    }
  }, [schedule, isFirebaseConfigured]);

  useEffect(() => {
    localStorage.setItem('pillbox_caregiver', JSON.stringify(caregiverContact));
    if (isFirebaseConfigured && db) {
      set(ref(db, 'caregiver'), caregiverContact);
    }
  }, [caregiverContact, isFirebaseConfigured]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [newMed, setNewMed] = useState({ name: '', time: '', language: 'English', relation: '', slot: 1, stock: 30 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Audio Buzzer Logic
  const startBuzzer = useCallback(() => {
    if (!isSoundEnabled) return;
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    if (oscillatorRef.current) return;

    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch beep
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    
    oscillatorRef.current = osc;
    setTimeout(() => {
      oscillatorRef.current = null;
    }, 500);
  }, [isSoundEnabled]);

  const speakReminder = useCallback((text: string, lang: string = 'en-US') => {
    if (!isSoundEnabled) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'Hindi' ? 'hi-IN' : 'en-US';
    window.speechSynthesis.speak(utterance);
  }, [isSoundEnabled]);

  const addNotification = (message: string, type: 'info' | 'alert' = 'info') => {
    setNotifications(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      message,
      timestamp: new Date(),
      type
    }, ...prev].slice(0, 20));
  };

  // Update time and check schedule
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      
      schedule.forEach(item => {
        if (item.time === timeStr && dueSlot !== item.slot && item.status === 'pending') {
          setDueSlot(item.slot);
          addLog(`ALARM: ${item.pillName} is due! Slot ${item.slot} active.`);
          
          const msg = item.language === 'Hindi' 
            ? `Namaste ${item.relation || 'ji'}, aapki ${item.pillName} ka samay ho gaya hai.`
            : `Hello ${item.relation || 'there'}, it's time for your ${item.pillName}.`;
          
          speakReminder(msg, item.language);
          addNotification(`Reminder sent for ${item.pillName}`, 'info');
        }
      });

      if (dueSlot) {
        startBuzzer();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [schedule, dueSlot, startBuzzer, speakReminder]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setUploadedImage(result);
        addLog(`Image uploaded: ${file.name}`);
        setPillResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeUploadedImage = async () => {
    if (!uploadedImage) return;
    
    setIsAnalyzing(true);
    addLog("Processing image for inference...");

    try {
      const result = await identifyPill(uploadedImage);
      
      if (result.error) {
        addLog(`Inference failed: ${result.error}`);
      } else {
        setPillResult(result);
        addLog(`AI Result: ${result.name} (${Math.round(result.confidence * 100)}% confidence)`);
        
        const match = schedule.find(s => 
          s.pillName.toLowerCase() === result.name.toLowerCase() || 
          s.pillName.toLowerCase() === result.match?.toLowerCase()
        );

        if (match) {
          addLog(`VERIFIED: ${match.pillName} detected. Clearing alarm...`);
          setActiveSlot(match.slot);
          setDueSlot(null);
          
          // Update status to taken
          setSchedule(prev => prev.map(s => s.id === match.id ? { ...s, status: 'taken' } : s));
          addNotification(`${match.pillName} marked as TAKEN via AI verification.`, 'info');
          
          addLog(`SERIAL OUT: 'RESET_${match.slot}'`);
          setTimeout(() => setActiveSlot(null), 3000);
        } else {
          addLog("No schedule match for detected pill.");
        }
      }
    } catch (err: any) {
      addLog(`Error: ${err.message || "Analysis failed"}`);
    }
    setIsAnalyzing(false);
  };

  const toggleVoiceInterface = () => {
    if (!('webkitSpeechRecognition' in window)) {
      addNotification("Speech recognition not supported in this browser.", 'alert');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    setIsListening(true);
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setChatInput(transcript);
      setIsListening(false);
      addLog(`Voice Input: "${transcript}"`);
      // Auto-submit voice query
      handleChatSubmit({ preventDefault: () => {} } as any, transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
      addNotification("Voice recognition error.", 'alert');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleChatSubmit = async (e: React.FormEvent, overrideInput?: string) => {
    e.preventDefault();
    const input = overrideInput || chatInput;
    if (!input.trim() || isChatLoading) return;

    const userMsg = input.trim();
    if (!overrideInput) setChatInput("");
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatLoading(true);

    const response = await getChatResponse(userMsg, []);
    setChatMessages(prev => [...prev, { role: 'assistant', content: response || "I'm sorry, I couldn't process that." }]);
    setIsChatLoading(false);
  };

  const triggerManualAlarm = (slot: number) => {
    const item = schedule.find(s => s.slot === slot);
    setDueSlot(slot);
    addLog(`MANUAL TRIGGER: Alarm activated for Slot ${slot}.`);
    
    if (item) {
      const msg = item.language === 'Hindi' 
        ? `Namaste ${item.relation || 'ji'}, aapki ${item.pillName} ka samay ho gaya hai.`
        : `Hello ${item.relation || 'there'}, it's time for your ${item.pillName}.`;
      speakReminder(msg, item.language);
    }
  };

  const markAsTaken = (id: string) => {
    const item = schedule.find(s => s.id === id);
    if (item) {
      setSchedule(prev => prev.map(s => s.id === id ? { ...s, status: 'taken' } : s));
      if (dueSlot === item.slot) setDueSlot(null);
      addLog(`MANUAL ACTION: ${item.pillName} marked as TAKEN.`);
      addNotification(`${item.pillName} marked as TAKEN.`, 'info');
    }
  };

  const markAsMissed = (id: string) => {
    const item = schedule.find(s => s.id === id);
    if (item) {
      setSchedule(prev => prev.map(s => s.id === id ? { ...s, status: 'missed' } : s));
      if (dueSlot === item.slot) setDueSlot(null);
      addLog(`MANUAL ACTION: ${item.pillName} was MISSED.`);
      addNotification(`ALERT: ${item.pillName} was MISSED! Caregiver notified.`, 'alert');
      
      // Emotion-aware prompt
      const relation = item.relation || 'dear';
      const msg = item.language === 'Hindi'
        ? `Aapne apni ${item.pillName} nahi li. Kya main aapke caregiver ko message bhej doon?`
        : `It seems you missed your ${item.pillName}, ${relation}. I've notified your caregiver. Would you like me to call them for you?`;
      speakReminder(msg, item.language);
    }
  };

  const deleteMedication = (id: string) => {
    const item = schedule.find(s => s.id === id);
    if (item) {
      setSchedule(prev => prev.filter(s => s.id !== id));
      if (dueSlot === item.slot) setDueSlot(null);
      addLog(`SYSTEM: ${item.pillName} (Slot ${item.slot}) removed from schedule.`);
      addNotification(`${item.pillName} removed.`, 'info');
    }
  };

  const addMedication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMed.name || !newMed.time) return;
    
    // Drug Interaction Safety Check (Simulated)
    const existingMeds = schedule.map(s => s.pillName.toLowerCase());
    const newMedName = newMed.name.toLowerCase();
    
    const interactions: Record<string, string[]> = {
      'aspirin': ['warfarin', 'ibuprofen'],
      'warfarin': ['aspirin', 'ibuprofen', 'vitamin k'],
      'metformin': ['alcohol', 'contrast dye'],
      'lisinopril': ['potassium supplements'],
    };

    const potentialRisks = interactions[newMedName]?.filter(med => existingMeds.includes(med));

    if (potentialRisks && potentialRisks.length > 0) {
      const warning = `⚠️ SAFETY ALERT: Potential interaction detected between ${newMed.name} and ${potentialRisks.join(', ')}. Please consult your doctor before adding this medication.`;
      addNotification(warning, 'alert');
      addLog(`SAFETY: Interaction blocked for ${newMed.name}.`);
      
      const confirmAdd = window.confirm(`${warning}\n\nDo you still want to add it?`);
      if (!confirmAdd) return;
    }
    
    const newItem: ScheduleItem = {
      id: Math.random().toString(36).substr(2, 9),
      pillName: newMed.name,
      time: newMed.time,
      slot: newMed.slot,
      language: newMed.language,
      relation: newMed.relation,
      status: 'pending',
      stock: newMed.stock || 30
    };
    
    setSchedule(prev => [...prev, newItem]);
    setNewMed({ name: '', time: '', language: 'English', relation: '', slot: 1, stock: 30 });
    addLog(`System: New medication added - ${newItem.pillName}`);
    setActiveTab('dashboard');
  };

  const resetHardware = () => {
    setActiveSlot(null);
    setDueSlot(null);
    addLog("Hardware reset signal received.");
  };

  const formattedTime = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Sidebar Navigation - Desktop */}
      <nav className="fixed left-0 top-0 bottom-0 w-20 bg-black border-r border-white/5 flex-col items-center py-8 gap-8 z-50 hidden md:flex">
        <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)] mb-4">
          <Cpu className="w-6 h-6 text-black" />
        </div>
        
        <div className="flex flex-col gap-4">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'analytics', icon: BarChart3, label: 'Analytics' },
            { id: 'inventory', icon: Package, label: 'Inventory' },
            { id: 'history', icon: History, label: 'History' },
            { id: 'setup', icon: Settings, label: 'Setup' },
            { id: 'code', icon: FileCode, label: 'Code' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "p-3 rounded-xl transition-all group relative",
                activeTab === item.id ? "bg-emerald-500/10 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]" : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5"
              )}
            >
              <item.icon className="w-6 h-6" />
              <span className="absolute left-full ml-4 px-2 py-1 bg-zinc-900 text-white text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none uppercase tracking-widest border border-white/10">
                {item.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-4">
          <button 
            onClick={() => setIsSoundEnabled(!isSoundEnabled)}
            className={cn(
              "p-3 rounded-xl transition-all",
              isSoundEnabled ? "text-emerald-500 bg-emerald-500/10" : "text-zinc-600"
            )}
          >
            {isSoundEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
          </button>
          <button 
            onClick={() => user ? handleLogout() : setIsLoginModalOpen(true)}
            className={cn(
              "p-3 rounded-xl transition-all",
              user ? "text-emerald-500 bg-emerald-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
          >
            <User className="w-6 h-6" />
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="md:pl-20 min-h-screen flex flex-col">
        {/* Top Header */}
        <header className="h-20 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between px-4 md:px-8 sticky top-0 z-40">
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">AI PILLBOX <span className="text-emerald-500">PROTOTYPE</span></h1>
            <p className="text-[9px] md:text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold">Smart Healthcare System • v2.0</p>
          </div>
          
          <div className="flex items-center gap-4 md:gap-8">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xl md:text-2xl font-mono font-bold text-emerald-500 tracking-tighter">{formattedTime}</span>
              <span className="text-[9px] md:text-[10px] text-zinc-600 uppercase font-bold">{currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>
            
            <div className="hidden sm:block h-10 w-[1px] bg-white/10" />
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => {
                  addNotification("EMERGENCY SOS ACTIVATED! Caregiver and services notified.", 'alert');
                  addLog("EMERGENCY: SOS button pressed. GPS coordinates sent.");
                }}
                className="p-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
              >
                <ShieldAlert className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase hidden lg:block">SOS</span>
              </button>
              <div className="hidden xs:flex flex-col items-end">
                <span className="text-[10px] md:text-xs font-bold text-zinc-300">System Integrity</span>
                <span className="text-[9px] md:text-[10px] text-emerald-500 uppercase font-bold">Encrypted & Secure</span>
              </div>
              <ShieldCheck className="w-6 h-6 md:w-8 md:h-8 text-emerald-500" />
            </div>
          </div>
        </header>

        {/* Mobile Navigation - Bottom Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl border-t border-white/5 flex justify-around items-center py-3 z-50">
          {[
            { id: 'dashboard', icon: LayoutDashboard },
            { id: 'analytics', icon: BarChart3 },
            { id: 'inventory', icon: Package },
            { id: 'history', icon: History },
            { id: 'setup', icon: Settings }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "p-2 rounded-xl transition-all",
                activeTab === item.id ? "text-emerald-500 bg-emerald-500/10" : "text-zinc-600"
              )}
            >
              <item.icon className="w-6 h-6" />
            </button>
          ))}
        </nav>

        {/* Login Modal */}
        <AnimatePresence>
          {isLoginModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsLoginModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="p-8 border-b border-white/5 bg-white/2">
                  <h2 className="text-2xl font-black tracking-tighter uppercase">Secure Access</h2>
                  <p className="text-xs text-zinc-500 font-mono mt-1">PHONE_AUTH_PROTOCOL v2.0</p>
                </div>
                <div className="p-8 space-y-6">
                  {!confirmationResult ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-black text-zinc-500 tracking-widest">Phone Number</label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                          <input 
                            type="tel" 
                            placeholder="+1 234 567 8900"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            className="w-full bg-black/40 border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm focus:border-emerald-500 transition-all outline-none"
                          />
                        </div>
                      </div>
                      <button 
                        onClick={handleSendOtp}
                        className="w-full py-4 bg-emerald-500 text-black font-black rounded-xl hover:bg-emerald-400 transition-all uppercase tracking-widest text-xs"
                      >
                        Send Verification Code
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-black text-zinc-500 tracking-widest">Verification Code</label>
                        <input 
                          type="text" 
                          placeholder="123456"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          className="w-full bg-black/40 border border-white/5 rounded-xl py-4 text-center text-2xl font-black tracking-[0.5em] focus:border-emerald-500 transition-all outline-none"
                        />
                      </div>
                      <button 
                        onClick={handleVerifyOtp}
                        className="w-full py-4 bg-emerald-500 text-black font-black rounded-xl hover:bg-emerald-400 transition-all uppercase tracking-widest text-xs"
                      >
                        Verify & Continue
                      </button>
                      <button 
                        onClick={() => setConfirmationResult(null)}
                        className="w-full text-[10px] text-zinc-500 uppercase font-bold hover:text-zinc-300 transition-all"
                      >
                        Change Phone Number
                      </button>
                    </div>
                  )}
                  <div id="recaptcha-container"></div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <main className="p-4 md:p-8 max-w-[1600px] mx-auto grid grid-cols-12 gap-4 md:gap-8 pb-24 md:pb-8">
          
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Left Column: Vision & Analysis */}
              <div className="col-span-12 lg:col-span-8 space-y-8">
                
                {/* Vision Module */}
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                  <div className="p-6 border-b border-white/5 bg-white/2 flex items-center justify-between bg-white/2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                        <ImageIcon className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider">Vision Analysis Module</h3>
                        <p className="text-[10px] text-zinc-500 font-mono">Input: RGB_UHD_STREAM | Model: GEMINI_3_FLASH</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", uploadedImage ? "bg-emerald-500 animate-pulse" : "bg-zinc-700")} />
                      <span className="text-[10px] uppercase font-bold text-zinc-500">{uploadedImage ? "Buffer Loaded" : "Standby"}</span>
                    </div>
                  </div>

                  <div className="aspect-[16/9] bg-[#020202] relative group">
                    {!uploadedImage ? (
                      <label 
                        className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-white/2 transition-all"
                      >
                        <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 transition-transform">
                          <Upload className="w-10 h-10 text-zinc-500" />
                        </div>
                        <h4 className="text-lg font-bold text-zinc-300">Drop medication photo here</h4>
                        <p className="text-sm text-zinc-600 mt-2">Neural network ready for classification</p>
                        <input type="file" onChange={handleFileUpload} accept="image/*" className="hidden" />
                      </label>
                    ) : (
                      <div className="w-full h-full p-8">
                        <div className="w-full h-full rounded-2xl overflow-hidden border border-white/10 relative">
                          <img src={uploadedImage} alt="Pill" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                          <button 
                            onClick={() => setUploadedImage(null)}
                            className="absolute top-6 right-6 p-3 bg-black/60 hover:bg-black/90 rounded-2xl text-white backdrop-blur-md border border-white/10 transition-all"
                          >
                            <X className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isAnalyzing && (
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-30">
                        <div className="relative">
                          <RefreshCw className="w-16 h-16 text-emerald-500 animate-spin" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-4 h-4 bg-emerald-500 rounded-full animate-ping" />
                          </div>
                        </div>
                        <p className="mt-8 text-emerald-500 font-mono text-sm tracking-[0.3em] font-bold animate-pulse uppercase">Processing Inference...</p>
                        <div className="mt-4 w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ x: "-100%" }}
                            animate={{ x: "100%" }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            className="w-full h-full bg-emerald-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-6 bg-black/40 flex items-center justify-between">
                    <button 
                      disabled={!uploadedImage || isAnalyzing}
                      onClick={analyzeUploadedImage}
                      className="px-8 py-3 bg-white text-black font-black rounded-xl hover:bg-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed transition-all flex items-center gap-3 shadow-[0_10px_20px_rgba(255,255,255,0.1)]"
                    >
                      <Activity className="w-5 h-5" />
                      RUN CLASSIFICATION
                    </button>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Latency</p>
                        <p className="text-sm font-mono text-zinc-300">~240ms</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Accuracy</p>
                        <p className="text-sm font-mono text-emerald-500">98.4%</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* AI Assistant Module */}
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl overflow-hidden flex flex-col h-[500px] shadow-2xl">
                  <div className="p-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                        <Bot className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider">AI Support Assistant</h3>
                        <p className="text-[10px] text-zinc-500 font-mono">Medication Knowledge Base v4.2</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={cn(
                        "flex gap-4 max-w-[85%]",
                        msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                      )}>
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
                          msg.role === 'assistant' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-zinc-800 border-white/10 text-zinc-300"
                        )}>
                          {msg.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                        </div>
                        <div className={cn(
                          "p-4 rounded-2xl text-sm leading-relaxed",
                          msg.role === 'assistant' ? "bg-white/5 text-zinc-300 rounded-tl-none" : "bg-emerald-500 text-black font-medium rounded-tr-none"
                        )}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                          <Bot className="w-5 h-5 animate-pulse" />
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl rounded-tl-none flex gap-1 items-center">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <form onSubmit={handleChatSubmit} className="p-6 bg-black/40 border-t border-white/5">
                    <div className="relative flex gap-3">
                      <div className="relative flex-1">
                        <input 
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Ask about your medication or schedule..."
                          className="w-full bg-zinc-900 border border-white/10 rounded-2xl py-4 pl-6 pr-16 text-sm focus:outline-none focus:border-emerald-500/50 transition-all"
                        />
                        <button 
                          type="submit"
                          disabled={!chatInput.trim() || isChatLoading}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-emerald-500 text-black rounded-xl hover:bg-emerald-400 disabled:opacity-20 transition-all"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </div>
                      <button 
                        type="button"
                        onClick={toggleVoiceInterface}
                        className={cn(
                          "p-4 rounded-2xl transition-all border",
                          isListening 
                            ? "bg-red-500 text-white border-red-500 animate-pulse" 
                            : "bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10"
                        )}
                      >
                        <Mic className="w-6 h-6" />
                      </button>
                    </div>
                  </form>
                </section>
              </div>

              {/* Right Column: Hardware & Schedule */}
              <div className="col-span-12 lg:col-span-4 space-y-8">
                
                {/* Hardware Simulation Module */}
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                        <Settings className="w-5 h-5 text-zinc-400" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Hardware Node</h3>
                    </div>
                    <button 
                      onClick={resetHardware}
                      className="p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all"
                    >
                      <RefreshCw className="w-5 h-5 text-zinc-500" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-6 mb-8">
                    {[1, 2].map(slot => {
                      const isDue = dueSlot === slot;
                      const isVerified = activeSlot === slot;
                      
                      return (
                        <div 
                          key={slot}
                          className={cn(
                            "aspect-square rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all duration-500 relative overflow-hidden",
                            isDue ? "bg-red-500/10 border-red-500/50 shadow-[0_0_40px_rgba(239,68,68,0.15)]" :
                            isVerified ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_40px_rgba(16,185,129,0.15)]" :
                            "bg-black/40 border-white/5"
                          )}
                        >
                          {isDue && (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0.1, 0.3, 0.1] }}
                              transition={{ duration: 1, repeat: Infinity }}
                              className="absolute inset-0 bg-red-500"
                            />
                          )}
                          <div className={cn(
                            "w-6 h-6 rounded-full border-4 border-black shadow-lg",
                            isDue ? "bg-red-500 animate-pulse" : 
                            isVerified ? "bg-emerald-500" : 
                            "bg-zinc-800"
                          )} />
                          <div className="text-center z-10">
                            <span className={cn(
                              "text-[10px] font-black uppercase tracking-[0.2em]",
                              isDue ? "text-red-500" : 
                              isVerified ? "text-emerald-500" : 
                              "text-zinc-600"
                            )}>Slot {slot}</span>
                            <p className="text-[8px] text-zinc-700 font-mono mt-1">GPIO_{slot + 12}</p>
                          </div>
                          {isDue && <Bell className="w-6 h-6 text-red-500 animate-bounce mt-2 z-10" />}
                          {isVerified && <CheckCircle2 className="w-6 h-6 text-emerald-500 mt-2 z-10" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-4 bg-black/40 p-6 rounded-2xl border border-white/5">
                    <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-widest">
                      <span className="text-zinc-500">Buzzer Frequency</span>
                      <span className={cn(dueSlot ? "text-red-500" : activeSlot ? "text-emerald-500" : "text-zinc-700")}>
                        {dueSlot ? "880Hz (ACTIVE)" : activeSlot ? "CLEARED" : "0Hz (IDLE)"}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                      {(dueSlot || activeSlot) && (
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: "100%" }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                          className={cn("h-full", dueSlot ? "bg-red-500" : "bg-emerald-500")} 
                        />
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-4">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", isSoundEnabled ? "bg-emerald-500" : "bg-zinc-700")} />
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Audio Output</span>
                      </div>
                      <span className="text-[10px] text-zinc-700 font-mono">SERIAL_BAUD: 9600</span>
                    </div>
                  </div>
                </section>

                {/* Active Reminders List */}
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                        <Clock className="w-5 h-5 text-zinc-400" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Active Reminders</h3>
                    </div>
                    <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                      <span className="text-[10px] text-emerald-500 font-bold uppercase">{schedule.filter(s => s.status === 'pending').length} Pending</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {schedule.map(item => (
                      <div key={item.id} className={cn(
                        "group flex flex-col p-5 bg-black/40 rounded-2xl border transition-all duration-300",
                        dueSlot === item.slot ? "border-red-500/50 bg-red-500/5" : 
                        item.status === 'taken' ? "border-emerald-500/20 bg-emerald-500/5" :
                        item.status === 'missed' ? "border-red-500/20 bg-red-500/5" :
                        "border-white/5 hover:border-white/10"
                      )}>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "w-12 h-12 rounded-xl flex items-center justify-center border",
                              dueSlot === item.slot ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-white/5 border-white/10 text-zinc-500"
                            )}>
                              <div className="text-lg font-black">{item.slot}</div>
                            </div>
                            <div>
                              <div className="text-sm font-bold text-zinc-200">{item.pillName}</div>
                              <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                                {item.relation} • {item.language}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-lg font-mono font-bold text-emerald-500 tracking-tighter">{item.time}</div>
                              <div className={cn(
                                "text-[10px] uppercase font-bold tracking-widest",
                                item.status === 'taken' ? "text-emerald-500" :
                                item.status === 'missed' ? "text-red-500" : "text-zinc-600"
                              )}>
                                {item.status}
                              </div>
                            </div>
                            <button 
                              onClick={() => deleteMedication(item.id)}
                              className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                              title="Delete Slot"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <button 
                            onClick={() => triggerManualAlarm(item.slot)}
                            className="flex-1 py-2 bg-white/5 hover:bg-red-500 hover:text-white rounded-xl text-[10px] font-bold uppercase transition-all border border-white/5 flex items-center justify-center gap-2"
                          >
                            <Bell className="w-3 h-3" /> Test Voice
                          </button>
                          <button 
                            onClick={() => markAsTaken(item.id)}
                            className="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500 hover:text-black rounded-xl text-[10px] font-bold uppercase transition-all border border-emerald-500/20 flex items-center justify-center gap-2"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Taken
                          </button>
                          <button 
                            onClick={() => markAsMissed(item.id)}
                            className="flex-1 py-2 bg-red-500/10 hover:bg-red-500 hover:text-white rounded-xl text-[10px] font-bold uppercase transition-all border border-red-500/20 flex items-center justify-center gap-2"
                          >
                            <X className="w-3 h-3" /> Missed
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Notification Log Module */}
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                        <Bell className="w-5 h-5 text-zinc-400" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Notification Log</h3>
                    </div>
                  </div>

                  <div className="space-y-4 max-h-60 overflow-y-auto pr-2 scrollbar-hide">
                    {notifications.length === 0 ? (
                      <p className="text-center text-zinc-600 text-xs py-8">No recent notifications</p>
                    ) : (
                      notifications.map(note => (
                        <div key={note.id} className={cn(
                          "p-4 rounded-2xl border flex items-start gap-4",
                          note.type === 'alert' ? "bg-red-500/5 border-red-500/20" : "bg-white/5 border-white/10"
                        )}>
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                            note.type === 'alert' ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
                          )}>
                            {note.type === 'alert' ? <AlertCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                          </div>
                          <div className="flex-1">
                            <p className="text-xs text-zinc-300 leading-relaxed">{note.message}</p>
                            <p className="text-[10px] text-zinc-600 mt-1 font-mono">{note.timestamp.toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          {/* Setup Tab */}
          {activeTab === 'setup' && (
            <div className="col-span-12 max-w-4xl mx-auto w-full space-y-8">
              <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                    <Settings className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h3 className="text-lg font-bold uppercase tracking-wider">Medication Setup Form</h3>
                </div>

                {/* Firebase Connection Status */}
                <div className={cn(
                  "mb-8 p-6 rounded-2xl border flex items-center justify-between",
                  isFirebaseConfigured ? "bg-emerald-500/5 border-emerald-500/20" : "bg-amber-500/5 border-amber-500/20"
                )}>
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center",
                      isFirebaseConfigured ? "bg-emerald-500/20 text-emerald-500" : "bg-amber-500/20 text-amber-500"
                    )}>
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-wider">
                        {isFirebaseConfigured ? "Cloud Sync Enabled" : "Cloud Sync: Local Mode"}
                      </h4>
                      <p className="text-xs text-zinc-500 mt-1">
                        {isFirebaseConfigured 
                          ? "Your data is securely synced with Firebase Realtime Database." 
                          : "Data is currently stored only in this browser. Configure Firebase to enable multi-device sync."}
                      </p>
                    </div>
                  </div>
                  {!isFirebaseConfigured && (
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Action Required</p>
                      <p className="text-[9px] text-zinc-600 max-w-[200px]">Add Firebase keys to .env to enable cloud features.</p>
                    </div>
                  )}
                </div>

                <form onSubmit={addMedication} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Medicine Name</label>
                    <input 
                      type="text" 
                      value={newMed.name}
                      onChange={e => setNewMed({ ...newMed, name: e.target.value })}
                      placeholder="e.g. Paracetamol"
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Reminder Time</label>
                    <input 
                      type="time" 
                      value={newMed.time}
                      onChange={e => setNewMed({ ...newMed, time: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Language</label>
                    <select 
                      value={newMed.language}
                      onChange={e => setNewMed({ ...newMed, language: e.target.value })}
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    >
                      <option>English</option>
                      <option>Hindi</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Relation (e.g. Amma, Papa)</label>
                    <input 
                      type="text" 
                      value={newMed.relation}
                      onChange={e => setNewMed({ ...newMed, relation: e.target.value })}
                      placeholder="e.g. Amma"
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Hardware Slot</label>
                    <select 
                      value={newMed.slot}
                      onChange={e => setNewMed({ ...newMed, slot: parseInt(e.target.value) })}
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    >
                      <option value={1}>Slot 1</option>
                      <option value={2}>Slot 2</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Initial Stock (Pills)</label>
                    <input 
                      type="number" 
                      value={newMed.stock || 0}
                      onChange={e => setNewMed({ ...newMed, stock: parseInt(e.target.value) })}
                      placeholder="30"
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div className="md:col-span-2 pt-4">
                    <button type="submit" className="w-full py-4 bg-emerald-500 text-black font-black rounded-xl hover:bg-emerald-400 transition-all uppercase tracking-widest">
                      Add to Schedule
                    </button>
                  </div>
                </form>
              </section>

              <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                    <User className="w-5 h-5 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-bold uppercase tracking-wider">Caregiver Contact</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Email Address</label>
                    <input 
                      type="email" 
                      value={caregiverContact.email}
                      onChange={e => setCaregiverContact({ ...caregiverContact, email: e.target.value })}
                      placeholder="caregiver@example.com"
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phone Number</label>
                    <input 
                      type="tel" 
                      value={caregiverContact.phone}
                      onChange={e => setCaregiverContact({ ...caregiverContact, phone: e.target.value })}
                      placeholder="+1 234 567 890"
                      className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="col-span-12 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-zinc-900/30 border border-white/5 rounded-3xl p-6 shadow-xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Adherence Rate</p>
                  <h4 className="text-4xl font-black text-emerald-500">94.2%</h4>
                  <div className="mt-4 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 w-[94.2%]" />
                  </div>
                </div>
                <div className="bg-zinc-900/30 border border-white/5 rounded-3xl p-6 shadow-xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Total Doses Taken</p>
                  <h4 className="text-4xl font-black text-white">128</h4>
                  <p className="text-[10px] text-zinc-600 mt-2">LAST 30 DAYS</p>
                </div>
                <div className="bg-zinc-900/30 border border-white/5 rounded-3xl p-6 shadow-xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Missed Doses</p>
                  <h4 className="text-4xl font-black text-red-500">4</h4>
                  <p className="text-[10px] text-zinc-600 mt-2">CRITICAL_THRESHOLD: 10</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-8 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-500" /> Weekly Adherence Trend
                  </h3>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={[
                        { day: 'Mon', rate: 100 },
                        { day: 'Tue', rate: 85 },
                        { day: 'Wed', rate: 100 },
                        { day: 'Thu', rate: 100 },
                        { day: 'Fri', rate: 90 },
                        { day: 'Sat', rate: 100 },
                        { day: 'Sun', rate: 95 },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="day" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px' }}
                          itemStyle={{ color: '#10b981' }}
                        />
                        <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={3} dot={{ fill: '#10b981', r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-8 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-emerald-500" /> Dose Distribution
                  </h3>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Taken', value: 94 },
                            { name: 'Missed', value: 6 },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          <Cell fill="#10b981" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* Inventory Tab */}
          {activeTab === 'inventory' && (
            <div className="col-span-12 space-y-8">
              <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                      <Package className="w-5 h-5 text-zinc-400" />
                    </div>
                    <h3 className="text-sm font-bold uppercase tracking-wider">Medication Inventory</h3>
                  </div>
                  <button className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase transition-all">
                    Order Refills
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {schedule.map(item => (
                    <div key={item.id} className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-lg font-bold text-white">{item.pillName}</h4>
                          <p className="text-[10px] text-zinc-500 uppercase font-mono">Slot {item.slot}</p>
                        </div>
                        <div className={cn(
                          "px-2 py-1 rounded text-[10px] font-bold uppercase",
                          (item.stock || 0) < 5 ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
                        )}>
                          {(item.stock || 0) < 5 ? "Low Stock" : "In Stock"}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] uppercase font-black text-zinc-600">
                          <span>Quantity Remaining</span>
                          <span>{item.stock || 0} Pills</span>
                        </div>
                        <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full transition-all duration-1000", (item.stock || 0) < 5 ? "bg-red-500" : "bg-emerald-500")}
                            style={{ width: `${Math.min(((item.stock || 0) / 30) * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      <div className="pt-4 flex gap-2">
                        <button className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase transition-all border border-white/5">
                          Update Stock
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                    <Stethoscope className="w-5 h-5 text-zinc-400" />
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-wider">Side Effect & Symptom Log</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Log New Symptom</h4>
                      <div className="space-y-4">
                        <input 
                          type="text" 
                          placeholder="e.g. Dizziness, Nausea"
                          className="w-full bg-black border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 outline-none"
                        />
                        <div className="flex gap-2">
                          {['Low', 'Medium', 'High'].map(level => (
                            <button key={level} className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase transition-all border border-white/5">
                              {level}
                            </button>
                          ))}
                        </div>
                        <button className="w-full py-3 bg-emerald-500 text-black font-black rounded-xl hover:bg-emerald-400 transition-all uppercase tracking-widest text-xs">
                          Record Entry
                        </button>
                      </div>
                    </div>

                    <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Vitals Monitor</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white/2 rounded-xl border border-white/5 flex items-center gap-4">
                          <Thermometer className="w-6 h-6 text-orange-500" />
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase font-bold">Temp</p>
                            <p className="text-lg font-mono font-bold">{vitals.temp}°F</p>
                          </div>
                        </div>
                        <div className="p-4 bg-white/2 rounded-xl border border-white/5 flex items-center gap-4">
                          <Heart className="w-6 h-6 text-red-500 animate-pulse" />
                          <div>
                            <p className="text-[10px] text-zinc-500 uppercase font-bold">Heart Rate</p>
                            <p className="text-lg font-mono font-bold">{vitals.heartRate} BPM</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-black/40 border border-white/5 rounded-2xl p-6 overflow-y-auto max-h-[400px]">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Recent Logs</h4>
                    <div className="space-y-4">
                      {symptoms.length === 0 ? (
                        <p className="text-zinc-600 text-xs italic text-center py-8">No symptoms logged in the last 24 hours.</p>
                      ) : (
                        symptoms.map(log => (
                          <div key={log.id} className="p-4 bg-white/2 rounded-xl border border-white/5 flex justify-between items-center">
                            <div>
                              <p className="text-sm font-bold text-zinc-200">{log.symptom}</p>
                              <p className="text-[10px] text-zinc-500 font-mono">{log.timestamp.toLocaleTimeString()}</p>
                            </div>
                            <span className={cn(
                              "px-2 py-1 rounded text-[8px] font-bold uppercase",
                              log.severity === 'high' ? "bg-red-500/10 text-red-500" :
                              log.severity === 'medium' ? "bg-orange-500/10 text-orange-500" : "bg-emerald-500/10 text-emerald-500"
                            )}>
                              {log.severity}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Code Tab */}
          {activeTab === 'code' && (
            <div className="col-span-12 space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                  <div className="p-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                        <FileCode className="w-5 h-5 text-emerald-500" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Python Backend (AI)</h3>
                    </div>
                    <button className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors">
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-8 bg-black/40 font-mono text-xs overflow-x-auto">
                    <pre className="text-zinc-400 leading-relaxed">
                      {PYTHON_CODE}
                    </pre>
                  </div>
                </section>

                <section className="bg-zinc-900/30 border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                  <div className="p-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                        <Cpu className="w-5 h-5 text-emerald-500" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Arduino Controller (C++)</h3>
                    </div>
                    <button className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors">
                      <Download className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-8 bg-black/40 font-mono text-xs overflow-x-auto">
                    <pre className="text-zinc-400 leading-relaxed">
                      {ARDUINO_CODE}
                    </pre>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="col-span-12">
              <section className="bg-zinc-900/30 border border-white/5 rounded-3xl p-12 text-center shadow-2xl">
                <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-white/10">
                  <History className="w-10 h-10 text-zinc-600" />
                </div>
                <h2 className="text-2xl font-bold text-zinc-300">No History Recorded</h2>
                <p className="text-zinc-500 mt-4 max-w-md mx-auto">Once you start identifying pills and clearing alarms, your medication history will appear here for review.</p>
              </section>
            </div>
          )}

        </main>

        {/* Footer */}
        <footer className="p-12 border-t border-white/5 bg-black/20">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-black" />
                </div>
                <h4 className="font-black uppercase tracking-widest text-sm">AI PILLBOX SYSTEM</h4>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed max-w-lg">
                An advanced IoT prototype integrating Computer Vision, Neural Networks, and Embedded Systems to ensure medication adherence. Designed for real-world feasibility studies and smart healthcare integration.
              </p>
            </div>
            
            <div>
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mb-6">Project Resources</h5>
              <ul className="space-y-4 text-xs font-bold text-zinc-400">
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Technical Documentation</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Circuit Diagram (PDF)</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Component List</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Bill of Materials</li>
              </ul>
            </div>

            <div>
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mb-6">Future Scope</h5>
              <ul className="space-y-4 text-xs font-bold text-zinc-400">
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Caregiver Portal Dashboard</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Mobile-Friendly Navigation</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Twilio/WhatsApp Integration</li>
                <li className="hover:text-emerald-500 cursor-pointer transition-colors">Firebase Push Notifications</li>
              </ul>
            </div>

            <div>
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 mb-6">System Status</h5>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-zinc-500 uppercase">Neural Engine</span>
                  <span className="text-emerald-500">OPTIMIZED</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-zinc-500 uppercase">Serial Bridge</span>
                  <span className="text-emerald-500">CONNECTED</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-zinc-500 uppercase">Cloud Sync</span>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-1 h-1 rounded-full animate-pulse", isFirebaseConfigured ? "bg-emerald-500" : "bg-amber-500")} />
                    <span className={isFirebaseConfigured ? "text-emerald-500" : "text-amber-500"}>
                      {isFirebaseConfigured ? "ACTIVE (FIREBASE)" : "ACTIVE (LOCAL)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-12 pt-12 border-t border-white/5 flex justify-between items-center">
            <p className="text-[10px] text-zinc-700 font-mono uppercase tracking-widest">© 2026 AI Pillbox Prototype • IoT Healthcare Solution</p>
            <div className="flex gap-6">
              <Info className="w-4 h-4 text-zinc-800" />
              <Settings className="w-4 h-4 text-zinc-800" />
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
