import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { read, utils, writeFile } from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { Client, Tour, Coordinates, Reminder, Transaction, ClientFile } from './types';
import { calculateDistance, formatTime } from './utils/distance';
import { 
  SearchIcon, MicIcon, PlusIcon, MapPinIcon, 
  PhoneIcon, WalletIcon, CalendarIcon, BellIcon, 
  TrashIcon, FileIcon, ImageIcon, DownloadIcon,
  WhatsAppIcon, MailIcon, GlobeIcon, MinusIcon, MaximizeIcon,
  SettingsIcon, UploadCloudIcon, DownloadCloudIcon, PaletteIcon,
  CloudIcon, RefreshIcon, DatabaseIcon, SunIcon, RainIcon,
  CheckIcon,
  XIcon
} from './components/Icons';

// App Palette
const COLORS = {
  viola: '#7c3aed', // Purple
  verde: '#10b981', // Green (Avere)
  ocra: '#f59e0b',  // Ochre (Dare)
  grigio: '#6b7280', // Grey
  grigioLight: '#f3f4f6'
};

// Types for Cloud Configuration
type CloudProvider = 'none' | 'supabase';
interface CloudConfig {
  provider: CloudProvider;
  url: string;
  key: string;
}

const App: React.FC = () => {
  // --- State ---
  const [clients, setClients] = useState<Client[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [activeTab, setActiveTab] = useState<'list' | 'map' | 'tour' | 'add' | 'settings' | 'tour_selection'>('list');
  const [tourSubTab, setTourSubTab] = useState<'planned' | 'history' | 'calendar'>('planned');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  
  // New State for Tour Mini-Card
  const [selectedTourStop, setSelectedTourStop] = useState<Client | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<any[]>([]);
  const [tourSelection, setTourSelection] = useState<string[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Tour Planning State
  const [tourDate, setTourDate] = useState(new Date().toISOString().split('T')[0]);
  const [showTourGuide, setShowTourGuide] = useState(false);
  const [startPointType, setStartPointType] = useState<'gps' | 'client'>('gps');
  const [startPointClientId, setStartPointClientId] = useState<string>('');

  // Radar State
  const [isRadarActive, setIsRadarActive] = useState(false);
  const [radarRange, setRadarRange] = useState(50); // km

  // Customization State
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() => {
  const savedUrl = localStorage.getItem('haircrm_supabase_url') || '';
  const savedKey = localStorage.getItem('haircrm_supabase_key') || '';
  const savedProvider = (savedUrl && savedKey) ? 'supabase' : 'none';
  return { provider: savedProvider, url: savedUrl, key: savedKey };
});

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');
  
  // Weather State
  const [weather, setWeather] = useState<{ temp: number, code: number, city: string } | null>(null);

  // Map State
  const [mapZoom, setMapZoom] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const creationLogoInputRef = useRef<HTMLInputElement>(null);
  const importExcelInputRef = useRef<HTMLInputElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Map Handlers ---
  const handleMapMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
  };

  const handleMapMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setMapOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMapMouseUp = () => setIsDragging(false);
  
  const handleZoomIn = () => setMapZoom(z => Math.min(z + 0.2, 5));
  const handleZoomOut = () => setMapZoom(z => Math.max(z - 0.2, 0.5));
  const handleResetMap = () => {
    setMapZoom(1);
    setMapOffset({ x: 0, y: 0 });
  };

  // --- Persistence & Auto-Sync ---
  useEffect(() => {
    // 1. Load Local Data Immediately
    const savedClients = localStorage.getItem('haircrm_clients');
    const savedTours = localStorage.getItem('haircrm_tours');
    const savedBg = localStorage.getItem('haircrm_bg');
    const savedCloud = localStorage.getItem('haircrm_cloud');
    
    if (savedClients) setClients(JSON.parse(savedClients));
    if (savedTours) setTours(JSON.parse(savedTours));
    if (savedBg) setBackgroundImage(savedBg);

    let currentCloudConfig = { provider: 'none', url: '', key: '' } as CloudConfig;
    if (savedCloud) {
        currentCloudConfig = JSON.parse(savedCloud);
        setCloudConfig(currentCloudConfig);
    }

    // 2. If Cloud Config exists, auto-fetch latest data (Sync on App Start)
    if (currentCloudConfig.provider === 'supabase' && currentCloudConfig.url && currentCloudConfig.key) {
        const fetchCloudData = async () => {
            setSyncStatus('syncing');
            try {
                const supabase = createClient(currentCloudConfig.url, currentCloudConfig.key);
                
                // Fetch Clients
                const { data: clientsData, error: clientsError } = await supabase.from('clients').select('data');
                if (clientsError) throw clientsError;
                
                if (clientsData) {
                    const fetchedClients = clientsData.map((row: any) => row.data as Client);
                    // Merge logic: simpler is "Cloud wins" on startup to ensure consistency across devices
                    if (fetchedClients.length > 0) {
                        setClients(fetchedClients);
                    }
                }
                setSyncStatus('saved');
            } catch (e) {
                console.error("Auto-fetch error", e);
                setSyncStatus('error');
            }
        };
        fetchCloudData();
    }
  }, []);

  // Save to LocalStorage whenever data changes
  useEffect(() => {
    localStorage.setItem('haircrm_clients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('haircrm_tours', JSON.stringify(tours));
  }, [tours]);
  
  useEffect(() => {
    if (backgroundImage) {
      try {
        localStorage.setItem('haircrm_bg', backgroundImage);
      } catch (e) {
        console.warn("LocalStorage quota exceeded for background image");
      }
    } else {
      localStorage.removeItem('haircrm_bg');
    }
  }, [backgroundImage]);

  useEffect(() => {
    localStorage.setItem('haircrm_cloud', JSON.stringify(cloudConfig));
  }, [cloudConfig]);

  // --- Auto-Sync Logic (Debounced) ---
  useEffect(() => {
    if (cloudConfig.provider !== 'supabase' || !cloudConfig.url || !cloudConfig.key) return;

    // Debounce the save to avoid hammering the API on every keystroke
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    setSyncStatus('syncing');
    
    autoSaveTimeoutRef.current = setTimeout(async () => {
        try {
            const supabase = createClient(cloudConfig.url, cloudConfig.key);
            
            // Upsert Clients
            const { error } = await supabase.from('clients').upsert(
                clients.map(c => ({ id: c.id, data: c }))
            );
            
            if (error) throw error;
            setSyncStatus('saved');
        } catch (e) {
            console.error("Auto-sync error", e);
            setSyncStatus('error');
        }
    }, 2000); // Wait 2 seconds of inactivity before saving

    return () => {
        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, [clients, cloudConfig]); // Trigger when clients change

  // --- Geolocation (Real-time Watch) ---
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }

    // Use watchPosition for real-time tracking (better for tours/radar)
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsStatus('active');
      },
      (err) => {
        console.warn("GPS non disponibile", err);
        setGpsStatus('error');
      },
      { 
        enableHighAccuracy: true, 
        timeout: 20000, 
        maximumAge: 1000 
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // --- Weather Logic ---
  const getWeatherLabel = (code: number) => {
    if (code === 0) return { label: 'Soleggiato', icon: <SunIcon className="w-8 h-8 text-yellow-500"/> };
    if (code >= 1 && code <= 3) return { label: 'Parz. Nuvoloso', icon: <CloudIcon className="w-8 h-8 text-gray-400"/> };
    if (code >= 45 && code <= 48) return { label: 'Nebbia', icon: <CloudIcon className="w-8 h-8 text-gray-300"/> };
    if (code >= 51) return { label: 'Pioggia', icon: <RainIcon className="w-8 h-8 text-blue-500"/> };
    return { label: 'Variabile', icon: <SunIcon className="w-8 h-8 text-orange-400"/> };
  }

  useEffect(() => {
      const fetchWeather = async () => {
          // Find next planned stop
          const nextTour = tours.find(t => t.status === 'planned' || !t.status); // default planned
          if (!nextTour || nextTour.stops.length === 0) {
              setWeather(null);
              return;
          }
          const nextStopId = nextTour.stops[0].clientId;
          const client = clients.find(c => c.id === nextStopId);
          
          if (client && client.coords) {
              try {
                  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${client.coords.lat}&longitude=${client.coords.lng}&current_weather=true`);
                  const data = await res.json();
                  if (data.current_weather) {
                      setWeather({
                          temp: data.current_weather.temperature,
                          code: data.current_weather.weathercode,
                          city: client.address.city
                      });
                  }
              } catch (e) {
                  console.error("Weather fetch failed", e);
              }
          }
      };
      
      if (activeTab === 'tour') {
          fetchWeather();
      }
  }, [activeTab, tours, clients]);

  // --- Manual Cloud Actions (Still useful for forcing sync) ---
  const handleCloudUpload = async () => {
    if (cloudConfig.provider !== 'supabase' || !cloudConfig.url || !cloudConfig.key) {
        return alert("Configurazione cloud incompleta o assente.");
    }
    setIsSyncing(true);
    try {
        const supabase = createClient(cloudConfig.url, cloudConfig.key);
        const { error } = await supabase.from('clients').upsert(
            clients.map(c => ({ id: c.id, data: c }))
        );
        if (error) throw error;
        alert("✅ Dati caricati forzatamente!");
        setSyncStatus('saved');
    } catch (e: any) {
        console.error(e);
        alert("Errore upload: " + e.message);
    } finally {
        setIsSyncing(false);
    }
  };

  const handleCloudDownload = async () => {
    if (cloudConfig.provider !== 'supabase' || !cloudConfig.url || !cloudConfig.key) {
        return alert("Configurazione cloud incompleta o assente.");
    }
    if (!confirm("Scaricare i dati forzatamente sovrascriverà quelli locali. Continuare?")) return;

    setIsSyncing(true);
    try {
        const supabase = createClient(cloudConfig.url, cloudConfig.key);
        const { data, error } = await supabase.from('clients').select('data');
        if (error) throw error;
        if (data) {
            const fetchedClients = data.map((row: any) => row.data as Client);
            setClients(fetchedClients);
            alert(`✅ ${fetchedClients.length} clienti sincronizzati!`);
        }
    } catch (e: any) {
        console.error(e);
        alert("Errore download: " + e.message);
    } finally {
        setIsSyncing(false);
    }
  };

  // --- Notifications ---
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      clients.forEach(client => {
        // Check general reminders
        client.reminders.forEach(r => {
          const alertTime = new Date(r.alertDate);
          if (!r.completed && Math.abs(alertTime.getTime() - now.getTime()) < 60000) {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`Promemoria: ${client.companyName}`, { body: r.text });
            } else {
              alert(`PROMEMORIA: ${client.companyName} - ${r.text}`);
            }
          }
        });

        // Check transaction alerts (Dare/Avere scadenze)
        client.transactions.forEach(t => {
          if (t.alertDate) {
            const alertTime = new Date(t.alertDate);
            if (Math.abs(alertTime.getTime() - now.getTime()) < 60000) {
              const typeLabel = t.type === 'dare' ? 'Scadenza Pagamento' : 'Promemoria Incasso';
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification(`${typeLabel}: ${client.companyName}`, { body: `${t.description} - €${t.amount.toFixed(2)}` });
              } else {
                alert(`${typeLabel}: ${client.companyName}\n${t.description} - €${t.amount.toFixed(2)}`);
              }
            }
          }
        });
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [clients]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // --- Search Logic (Enhanced) ---
  const filteredClients = useMemo(() => {
    // Helper function to normalize text (remove accents, lowercase)
    const normalize = (str: string) => {
        return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    };

    const q = normalize(searchQuery.trim());
    if (!q) return clients;
    
    const tokens = q.split(/\s+/);

    return clients.filter(c => {
      // Collect text from complex nested arrays (notes, transactions, files)
      const notesText = c.reminders ? c.reminders.map(r => r.text).join(' ') : '';
      const transText = c.transactions ? c.transactions.map(t => t.description).join(' ') : '';
      const filesText = c.files ? c.files.map(f => f.name).join(' ') : '';

      // Create a massive searchable string
      const rawString = [
        c.companyName, 
        c.firstName, 
        c.lastName, 
        c.address.city, 
        c.address.street, 
        c.address.zip, 
        c.address.region, 
        c.phone, 
        c.vatId, 
        c.email, 
        c.website,
        notesText,   // Search in notes/reminders
        transText,   // Search in transaction descriptions (e.g. "saldo", "acconto")
        filesText    // Search in filenames
      ].filter(Boolean).join(' '); // Join with space

      const searchable = normalize(rawString);

      // Every token from voice/text input must be present in the client data (AND logic)
      return tokens.every(token => searchable.includes(token));
    });
  }, [clients, searchQuery]);

  const filteredTours = useMemo(() => {
    return tours.filter(t => {
      if (tourSubTab === 'calendar') return true;
      const status = t.status || 'planned';
      return tourSubTab === 'planned' ? status === 'planned' : status === 'completed';
    });
  }, [tours, tourSubTab]);

  // --- Radar Logic ---
  const nearbyClients = useMemo(() => {
    if (!isRadarActive || !userLocation) return [];
    
    return filteredClients.map(c => {
        const dist = calculateDistance(userLocation, c.coords);
        return { ...c, distance: dist };
    })
    .filter(c => c.distance <= radarRange)
    .sort((a, b) => a.distance - b.distance);
  }, [filteredClients, isRadarActive, userLocation, radarRange]);

  // --- Handlers ---
  const addClient = (newClient: Client, navigateToList: boolean = true) => {
    setClients(prev => [...prev, newClient]);
    if (navigateToList) setActiveTab('list');
  };

  const updateClient = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
    if (selectedClient?.id === updatedClient.id) setSelectedClient(updatedClient);
  };

  const deleteClient = (id: string) => {
    if (confirm("Eliminare definitivamente?")) {
      setClients(prev => prev.filter(c => c.id !== id));
      setSelectedClient(null);
    }
  };

  const createTour = () => {
    if (tourSelection.length === 0) return;

    // 1. Determine Start Coordinates
    let currentCoords: Coordinates | null = userLocation;
    
    if (startPointType === 'client' && startPointClientId) {
      const startClient = clients.find(c => c.id === startPointClientId);
      if (startClient) {
        currentCoords = startClient.coords;
      }
    }

    if (!currentCoords) {
      if (!confirm("Posizione di partenza non disponibile (GPS disattivato o cliente non trovato). L'itinerario non sarà ottimizzato per distanza. Continuare?")) return;
    }

    // 2. Optimization Logic (Nearest Neighbor Greedy)
    let optimizedSelection: string[] = [];
    
    if (currentCoords) {
      let pendingClients = tourSelection.map(id => clients.find(c => c.id === id)).filter(Boolean) as Client[];
      let currentLocation = currentCoords;

      while (pendingClients.length > 0) {
        // Find closest client to currentLocation
        let closestIndex = -1;
        let minDistance = Infinity;

        pendingClients.forEach((c, index) => {
          const d = calculateDistance(currentLocation, c.coords);
          if (d < minDistance) {
            minDistance = d;
            closestIndex = index;
          }
        });

        if (closestIndex !== -1) {
          const closestClient = pendingClients[closestIndex];
          optimizedSelection.push(closestClient.id);
          currentLocation = closestClient.coords; // Move "pointer" to this client
          pendingClients.splice(closestIndex, 1); // Remove from pending
        } else {
          break; // Should not happen
        }
      }
    } else {
      optimizedSelection = [...tourSelection]; // Fallback: maintain selection order
    }

    const selectedDate = new Date(tourDate);
    const newTour: Tour = {
      id: crypto.randomUUID(),
      name: `Tour del ${selectedDate.toLocaleDateString()}`,
      date: selectedDate.toISOString(),
      stops: optimizedSelection.map(id => ({ clientId: id, scheduledTime: selectedDate.toISOString() })),
      status: 'planned'
    };
    
    setTours(prev => [...prev, newTour]);
    setTourSelection([]);
    setTourSubTab('planned');
    setActiveTab('tour');
    alert(`Itinerario creato con ${optimizedSelection.length} tappe ordinate!`);
  };

  // --- Excel Import/Export & Theme Handlers ---
  const handleExcelExport = () => {
    const wb = utils.book_new();
    const data = clients.map(c => ({
      ID: c.id,
      Azienda: c.companyName,
      Nome: c.firstName,
      Cognome: c.lastName,
      Telefono: c.phone,
      Email: c.email,
      Città: c.address.city,
      Indirizzo: c.address.street + ' ' + c.address.number,
      CAP: c.address.zip,
      Provincia: c.address.region,
      PIVA: c.vatId
    }));
    const ws = utils.json_to_sheet(data);
    utils.book_append_sheet(wb, ws, "Clienti");
    writeFile(wb, "HairCRM_Clienti.xlsx");
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = utils.sheet_to_json(ws);

      const newClients: Client[] = data.map((row: any) => ({
        id: crypto.randomUUID(),
        companyName: row['Azienda'] || row['Ragione Sociale'] || 'Senza Nome',
        firstName: row['Nome'] || '',
        lastName: row['Cognome'] || '',
        vatId: row['PIVA'] || row['Partita IVA'] || '',
        phone: row['Telefono'] || row['Cellulare'] || '',
        whatsapp: '',
        email: row['Email'] || '',
        website: row['Sito'] || '',
        address: {
            city: row['Città'] || '',
            street: row['Indirizzo'] || '',
            number: '',
            zip: row['CAP'] || '',
            region: row['Provincia'] || ''
        },
        coords: { lat: 41.9, lng: 12.4 }, // Default Rome coords if geo not present
        files: [],
        transactions: [],
        reminders: [],
        createdAt: new Date().toISOString()
      }));

      setClients(prev => [...prev, ...newClients]);
      alert(`${newClients.length} clienti importati con successo!`);
      setActiveTab('list');
    };
    reader.readAsBinaryString(file);
    // Reset input
    e.target.value = ''; 
  };

  const handleThemeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setBackgroundImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  // --- Voice Search ---
  const startVoiceSearch = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Riconoscimento vocale non supportato.");
    const recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (e: any) => setSearchQuery(e.results[0][0].transcript);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  // --- AI Discovery ---
  const discoverNewLeads = async () => {
    if (!userLocation) return alert("Posizione GPS necessaria.");
    setIsDiscovering(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Quali sono i migliori saloni di parrucchieri nelle vicinanze?`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: { latLng: { latitude: userLocation.lat, longitude: userLocation.lng } }
          }
        },
      });
      const text = response.text || "Nessun risultato.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      setDiscoveryResults([{ text, chunks }]);
    } catch (error) {
      console.error(error);
      alert("Errore nella ricerca.");
    } finally {
      setIsDiscovering(false);
    }
  };

  // --- Image/File Management ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedClient) return;
    const newFiles: ClientFile[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        const content = await new Promise<string>((res) => {
            reader.onloadend = () => res(reader.result as string);
            reader.readAsDataURL(file);
        });
        newFiles.push({ id: crypto.randomUUID(), name: file.name, type: file.type, content });
    }
    updateClient({ ...selectedClient, files: [...(selectedClient.files || []), ...newFiles] });
  };

  const handleLogoAI = async (companyName: string): Promise<string | null> => {
    if (!companyName) return null;
    setIsGeneratingLogo(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Crea un logo moderno, professionale e minimalista per un'azienda nel settore parrucchieri chiamata '${companyName}'. Il logo deve essere elegante, iconico e lussuoso.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      const parts = response.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      setIsGeneratingLogo(false);
    }
  };

  // --- Components ---

  const CalendarView: React.FC = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return (
      <div className="bg-white rounded-3xl p-6 shadow-xl border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-black text-lg uppercase tracking-widest text-purple-600">
            {currentMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex gap-2">
            <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100">←</button>
            <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="p-2 bg-gray-50 rounded-xl hover:bg-gray-100">→</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => <div key={d} className="text-[10px] font-black text-gray-300 text-center uppercase">{d}</div>)}
          {days.map((d, idx) => (
            <div key={idx} className={`h-20 border rounded-2xl p-2 relative ${d?.toDateString() === new Date().toDateString() ? 'border-purple-300 bg-purple-50/50' : 'bg-white'}`}>
              {d && <span className="text-xs font-black text-gray-400">{d.getDate()}</span>}
              <div className="flex flex-wrap gap-1 mt-1">
                {d && tours.filter(t => new Date(t.date).toDateString() === d.toDateString()).map(t => (
                  <div key={t.id} className="w-full h-1 bg-purple-400 rounded-full"></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const SettingsView: React.FC = () => (
    <div className="space-y-8 animate-in fade-in duration-700">
      <h2 className="text-2xl font-black text-gray-900 tracking-tighter">Impostazioni & Extra</h2>
      
      {/* Cloud Configuration Section - NEW */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-blue-50 rounded-full blur-3xl -translate-y-10 translate-x-10 opacity-50"></div>
        <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                <CloudIcon className="w-6 h-6"/>
            </div>
            <div>
                <h3 className="text-lg font-black text-gray-800">Integrazione Cloud</h3>
                <p className="text-xs text-gray-400 font-bold">Configura Supabase per sincronizzare PC, Tablet e Smartphone.</p>
            </div>
        </div>

        <div className="space-y-4 relative z-10">
            <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Provider Cloud</label>
                <select 
                    className="w-full bg-gray-50 p-3 rounded-xl font-bold outline-none border border-gray-100 text-sm"
                    value={cloudConfig.provider}
                    onChange={e => setCloudConfig({ ...cloudConfig, provider: e.target.value as CloudProvider })}
                >
                    <option value="none">Nessuno (Solo Locale)</option>
                    <option value="supabase">Supabase (Sincronizzazione Attiva)</option>
                </select>
            </div>

            {cloudConfig.provider === 'supabase' && (
                <div className="space-y-3 animate-in slide-in-from-top duration-300">
                    <input 
                        className="w-full bg-gray-50 p-3 rounded-xl font-bold outline-none border border-gray-100 text-sm" 
                        placeholder="Supabase Project URL (es. https://xyz.supabase.co)"
                        value={cloudConfig.url}
                        onChange={(e => {
  const newConfig = { ...cloudConfig, url: e.target.value };
  setCloudConfig(newConfig);
  localStorage.setItem('haircrm_supabase_url', e.target.value);
})}

                    />
                    <input 
                        className="w-full bg-gray-50 p-3 rounded-xl font-bold outline-none border border-gray-100 text-sm" 
                        placeholder="Supabase Public API Key"
                        value={cloudConfig.key}
                        onChange={(e => {
  const newKey = e.target.value;
  setCloudConfig({ ...cloudConfig, key: newKey });
  localStorage.setItem('haircrm_supabase_key', newKey);
})}

                        type="password"
                    />
                    <div className="bg-blue-50 p-3 rounded-xl text-[10px] text-blue-600 font-bold leading-relaxed">
                        IMPORTANTE: Inserisci le stesse chiavi su TUTTI i dispositivi per vedere i dati aggiornati ovunque.
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
                <button 
                    onClick={handleCloudUpload} 
                    disabled={isSyncing || cloudConfig.provider === 'none'}
                    className="flex items-center justify-center gap-2 py-3 bg-blue-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <UploadCloudIcon className="w-4 h-4" /> Upload Forzato
                </button>
                <button 
                    onClick={handleCloudDownload} 
                    disabled={isSyncing || cloudConfig.provider === 'none'}
                    className="flex items-center justify-center gap-2 py-3 bg-white border border-blue-200 text-blue-600 font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <DownloadCloudIcon className="w-4 h-4" /> Download Forzato
                </button>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Custom Theme */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center gap-4 relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-transparent opacity-50"></div>
             <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center relative z-10">
                <PaletteIcon className="w-8 h-8"/>
             </div>
             <div className="relative z-10">
                <h3 className="text-lg font-black text-gray-800">Tema Personalizzato</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">Carica uno sfondo per cambiare il look dell'App.</p>
                <p className="text-[10px] text-purple-500 font-bold mt-2 bg-purple-50 px-3 py-1 rounded-lg border border-purple-100">
                    💡 Consigliato: 1080x1920 px (Portrait), max 1MB
                </p>
             </div>
             <input type="file" ref={themeInputRef} className="hidden" accept="image/*" onChange={handleThemeUpload} />
             <div className="flex gap-2 w-full mt-2 relative z-10">
                <button onClick={() => themeInputRef.current?.click()} className="flex-1 py-3 bg-purple-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-purple-700 transition-colors">Carica Sfondo</button>
                {backgroundImage && (
                    <button onClick={() => setBackgroundImage(null)} className="py-3 px-4 bg-gray-100 text-gray-500 font-black rounded-xl hover:bg-red-100 hover:text-red-500 transition-colors"><TrashIcon className="w-4 h-4"/></button>
                )}
             </div>
          </div>

          {/* Import Excel */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center gap-4 relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent opacity-50"></div>
             <div className="w-16 h-16 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center relative z-10">
                <DatabaseIcon className="w-8 h-8"/>
             </div>
             <div className="relative z-10">
                <h3 className="text-lg font-black text-gray-800">Importa Clienti</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">Carica un file Excel (.xlsx) con le colonne: Azienda, Nome, Telefono, Città.</p>
             </div>
             <input type="file" ref={importExcelInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleExcelImport} />
             <button onClick={() => importExcelInputRef.current?.click()} className="w-full py-3 bg-green-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-green-700 transition-colors relative z-10">Seleziona File Excel</button>
          </div>

          {/* Export Excel */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-xl flex flex-col items-center text-center gap-4 relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-50"></div>
             <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center relative z-10">
                <DownloadCloudIcon className="w-8 h-8"/>
             </div>
             <div className="relative z-10">
                <h3 className="text-lg font-black text-gray-800">Esporta Lista</h3>
                <p className="text-xs text-gray-400 font-bold mt-1">Scarica l'intera lista clienti e i dati associati in formato Excel.</p>
             </div>
             <button onClick={handleExcelExport} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-colors relative z-10">Scarica Excel</button>
          </div>
      </div>
    </div>
  );

  const ClientForm: React.FC = () => {
    const [formData, setFormData] = useState({
      companyName: '', firstName: '', lastName: '', region: '', city: '', street: '', number: '', zip: '',
      vatId: '', phone: '', whatsapp: '', email: '', website: '', logo: ''
    });

    const [isSaving, setIsSaving] = useState(false);
    
    // New State for additional sections
    const [initialTransaction, setInitialTransaction] = useState({ type: 'dare', amount: '', description: '' });
    const [initialNote, setInitialNote] = useState('');
    const [initialFiles, setInitialFiles] = useState<ClientFile[]>([]);
    const formFileInputRef = useRef<HTMLInputElement>(null);

    const handleCreationLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => setFormData({ ...formData, logo: reader.result as string });
        reader.readAsDataURL(file);
    };

    const handleCreationLogoAI = async () => {
        const logo = await handleLogoAI(formData.companyName);
        if (logo) setFormData({ ...formData, logo });
    };

    const handleInitialFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        const newFiles: ClientFile[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            const content = await new Promise<string>((res) => {
                reader.onloadend = () => res(reader.result as string);
                reader.readAsDataURL(file);
            });
            newFiles.push({ id: crypto.randomUUID(), name: file.name, type: file.type, content });
        }
        setInitialFiles(prev => [...prev, ...newFiles]);
    };

    // Helper to render input with visual warning (non-blocking)
    const renderField = (placeholder: string, value: string, field: keyof typeof formData, important: boolean = false, type: string = "text") => (
        <div className="relative w-full">
            <input 
                type={type}
                className={`w-full p-4 rounded-2xl outline-none font-bold transition-all ${
                    important && !value 
                    ? 'bg-orange-50/50 text-gray-800 placeholder:text-orange-300 ring-1 ring-orange-100' 
                    : 'bg-gray-50 border-none focus:ring-2 focus:ring-purple-200'
                }`} 
                placeholder={placeholder} 
                value={value} 
                onChange={e => setFormData({...formData, [field]: e.target.value})} 
            />
            {important && !value && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-orange-400 uppercase tracking-widest pointer-events-none flex items-center gap-1">
                    ⚠ Dati mancanti
                </span>
            )}
        </div>
    );

    return (
      <form onSubmit={async (e) => {
        e.preventDefault();
        setIsSaving(true);
        
        const transactions: Transaction[] = [];
        if (initialTransaction.amount) {
            transactions.push({
                id: crypto.randomUUID(),
                type: initialTransaction.type as 'dare' | 'avere',
                amount: Number(initialTransaction.amount),
                description: initialTransaction.description || 'Saldo iniziale',
                date: new Date().toISOString()
            });
        }

        const reminders: Reminder[] = [];
        if (initialNote) {
            reminders.push({
                id: crypto.randomUUID(),
                text: initialNote,
                alertDate: new Date().toISOString(),
                completed: false
            });
        }

        // --- Geocoding Start ---
        const fullAddress = `${formData.street} ${formData.number}, ${formData.zip} ${formData.city} ${formData.region}`;
        let coords: Coordinates = { lat: 41.9, lng: 12.4 }; // Default fallback

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            // Use Gemini to understand the address and return coordinates via Google Maps Grounding/Search
            const response = await ai.models.generateContent({
                 model: 'gemini-2.5-flash',
                 contents: `Identifica le coordinate geografiche (latitudine e longitudine) precise per questo indirizzo: "${fullAddress}".
                            Se l'indirizzo è incompleto, cerca la città.
                            Rispondi ESCLUSIVAMENTE con i due numeri separati da virgola (es: 41.9028, 12.4964).`,
                 config: {
                     tools: [{ googleMaps: {} }]
                 }
            });
            const text = response.text || "";
            // Robust parsing for lat,lng
            const match = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
            if (match) {
                 coords = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
            }
        } catch(err) {
            console.error("Errore geocoding", err);
            // Fallback random offset to prevent complete overlap
            coords = { lat: 41.9 + Math.random() * 0.1, lng: 12.4 + Math.random() * 0.1 };
        }
        // --- Geocoding End ---

        const newClientObject: Client = {
          id: crypto.randomUUID(), ...formData,
          address: { region: formData.region, city: formData.city, street: formData.street, number: formData.number, zip: formData.zip },
          coords: coords, // Use calculated coordinates
          files: initialFiles, 
          transactions: transactions, 
          reminders: reminders, 
          createdAt: new Date().toISOString()
        };

        setIsSaving(false);

        if (confirm("✅ Cliente creato con successo!\n\nVuoi inserirne un altro subito?")) {
            // Stay on page, reset form
            addClient(newClientObject, false);
            
            // Manual Reset
            setFormData({
                companyName: '', firstName: '', lastName: '', region: '', city: '', street: '', number: '', zip: '',
                vatId: '', phone: '', whatsapp: '', email: '', website: '', logo: ''
            });
            setInitialTransaction({ type: 'dare', amount: '', description: '' });
            setInitialNote('');
            setInitialFiles([]);
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            // Go to list
            addClient(newClientObject, true);
        }

      }} className="p-8 space-y-8 max-w-4xl mx-auto bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 animate-in slide-in-from-bottom duration-500 pb-20 md:pb-8">
        <h2 className="text-3xl font-black tracking-tighter" style={{ color: COLORS.viola }}>Nuova Scheda Cliente</h2>
        
        <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex flex-col items-center gap-3 w-full md:w-auto">
                <div className="w-32 h-32 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden shadow-inner group relative cursor-pointer" onClick={() => creationLogoInputRef.current?.click()}>
                    {formData.logo ? <img src={formData.logo} className="w-full h-full object-cover" /> : <PlusIcon className="text-gray-300 w-8 h-8"/>}
                </div>
                <input type="file" ref={creationLogoInputRef} className="hidden" accept="image/*" onChange={handleCreationLogoUpload} />
                <div className="flex flex-col gap-1 w-full items-center">
                    <button type="button" onClick={() => creationLogoInputRef.current?.click()} className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-purple-600">Carica Logo</button>
                    <button type="button" onClick={handleCreationLogoAI} disabled={isGeneratingLogo} className="text-[10px] font-black text-purple-600 uppercase tracking-widest hover:text-purple-800 disabled:opacity-50">Genera con IA</button>
                </div>
            </div>

            <div className="flex-1 space-y-6 w-full">
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b pb-1">Dati Principali</h3>
                  <input className="w-full bg-gray-50 border-none p-4 rounded-2xl focus:ring-2 focus:ring-purple-200 outline-none font-bold" placeholder="Nome Azienda / Salone" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} required />
                  <div className="grid grid-cols-2 gap-4">
                      {renderField("Nome Titolare", formData.firstName, "firstName")}
                      {renderField("Cognome Titolare", formData.lastName, "lastName")}
                  </div>
                  {renderField("Partita I.V.A.", formData.vatId, "vatId")}
                </div>

                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b pb-1">Indirizzo</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      {renderField("Indirizzo / Via", formData.street, "street", true)}
                    </div>
                    {renderField("N° Civico", formData.number, "number", true)}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {renderField("Città", formData.city, "city", true)}
                    {renderField("CAP", formData.zip, "zip", true)}
                  </div>
                  {renderField("Regione", formData.region, "region", true)}
                </div>

                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b pb-1">Contatti & Web</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {renderField("Telefono", formData.phone, "phone", true)}
                    {renderField("WhatsApp", formData.whatsapp, "whatsapp")}
                  </div>
                  {renderField("Email", formData.email, "email")}
                  {renderField("Sito Web (https://...)", formData.website, "website")}
                </div>
            </div>
        </div>

        {/* 1. Situazione Contabile DARE/AVERE */}
        <div className="pt-6 border-t border-gray-100 space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <WalletIcon className="w-4 h-4"/> 1. Situazione Contabile Iniziale
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select className="bg-gray-50 border-none p-4 rounded-2xl font-bold outline-none" value={initialTransaction.type} onChange={e => setInitialTransaction({...initialTransaction, type: e.target.value})}>
                    <option value="dare">DARE (Debito Cliente)</option>
                    <option value="avere">AVERE (Credito Cliente)</option>
                </select>
                <input type="number" step="0.01" className="bg-gray-50 border-none p-4 rounded-2xl outline-none font-bold" placeholder="Importo € (Opzionale)" value={initialTransaction.amount} onChange={e => setInitialTransaction({...initialTransaction, amount: e.target.value})} />
                <input className="bg-gray-50 border-none p-4 rounded-2xl outline-none font-bold" placeholder="Descrizione (es. Saldo precedente)" value={initialTransaction.description} onChange={e => setInitialTransaction({...initialTransaction, description: e.target.value})} />
            </div>
        </div>

        {/* 2. Sezione Aggiunta Note */}
        <div className="pt-6 border-t border-gray-100 space-y-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <FileIcon className="w-4 h-4"/> 2. Note Iniziali
            </h3>
            <textarea className="w-full bg-gray-50 border-none p-4 rounded-2xl outline-none font-bold min-h-[100px]" placeholder="Scrivi qui eventuali note sul cliente..." value={initialNote} onChange={e => setInitialNote(e.target.value)}></textarea>
        </div>

        {/* 3. Sezione Archivio Documenti */}
        <div className="pt-6 border-t border-gray-100 space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <ImageIcon className="w-4 h-4"/> 3. Archivio Documenti & Immagini
                </h3>
                <button type="button" onClick={() => formFileInputRef.current?.click()} className="p-2 bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition-colors"><PlusIcon className="w-4 h-4"/></button>
                <input type="file" ref={formFileInputRef} className="hidden" multiple accept="image/png, image/jpeg" onChange={handleInitialFileUpload} />
            </div>
            
            {initialFiles.length > 0 ? (
                <div className="grid grid-cols-4 gap-3">
                    {initialFiles.map(file => (
                        <div key={file.id} className="aspect-square bg-gray-50 rounded-2xl p-1 relative group overflow-hidden border border-gray-100">
                             <img src={file.content} className="w-full h-full object-cover rounded-xl" />
                             <button type="button" onClick={() => setInitialFiles(prev => prev.filter(f => f.id !== file.id))} className="absolute top-1 right-1 bg-white text-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><TrashIcon className="w-3 h-3"/></button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="w-full py-8 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-300 gap-2 cursor-pointer hover:border-purple-200 hover:text-purple-400 transition-colors" onClick={() => formFileInputRef.current?.click()}>
                    <ImageIcon className="w-8 h-8 opacity-50"/>
                    <span className="text-[10px] font-black uppercase tracking-widest">Tocca per caricare JPG o PNG</span>
                </div>
            )}
        </div>
        
        <button type="submit" disabled={isSaving} className="w-full py-5 bg-purple-600 text-white font-black rounded-3xl shadow-xl hover:bg-purple-700 transition-all uppercase tracking-[0.2em] text-xs mt-8 disabled:opacity-50 disabled:cursor-wait">
            {isSaving ? 'Geolocalizzazione indirizzo in corso...' : 'Crea Scheda Cliente'}
        </button>
      </form>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 font-sans text-gray-800 relative">
      {/* Background Image */}
      {backgroundImage && (
        <div className="fixed inset-0 z-0 opacity-10 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${backgroundImage})` }} />
      )}

      {/* Main Content Area */}
      <div className="relative z-10 max-w-7xl mx-auto p-4 pt-6 md:p-8">
        
        {/* Header */}
        <header className="flex justify-between items-start mb-6">
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tight">
                <span className="text-emerald-600">HairCRM</span> 
                <span className="text-gray-400 ml-1">Pro</span>
            </h1>
            {cloudConfig.provider === 'supabase' && (
                <div className="flex items-center gap-1 mt-1">
                    <div className={`w-2 h-2 rounded-full ${syncStatus === 'saved' ? 'bg-green-500' : syncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse' : syncStatus === 'error' ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                        {syncStatus === 'saved' ? 'Cloud Attivo' : syncStatus === 'syncing' ? 'Sincronizzazione...' : syncStatus === 'error' ? 'Errore Sync' : 'Offline'}
                    </span>
                </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
              {/* GPS Badge */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm ${gpsStatus === 'active' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-600'}`}>
                  <div className={`w-2 h-2 rounded-full ${gpsStatus === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-[10px] font-black uppercase tracking-widest">
                      {gpsStatus === 'active' ? 'GPS ATTIVO' : gpsStatus === 'searching' ? 'CERCA...' : 'GPS OFF'}
                  </span>
              </div>

              {activeTab === 'tour' && weather && (
                 <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl shadow-sm border border-gray-100">
                    {getWeatherLabel(weather.code).icon}
                    <div className="text-xs font-bold leading-tight">
                        <div className="text-gray-900">{weather.city}</div>
                        <div className="text-gray-500">{weather.temp}°C</div>
                    </div>
                 </div>
              )}
          </div>
        </header>

        {/* Views */}
        {activeTab === 'list' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             {/* Search */}
             <div className="flex gap-3">
                 <div className="relative flex-1">
                    <input 
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Cerca cliente, città o telefono..." 
                      className="w-full bg-white p-4 pl-12 rounded-2xl shadow-sm border border-gray-100 outline-none font-bold text-gray-700 placeholder:text-gray-300 focus:ring-2 focus:ring-purple-100 transition-all"
                    />
                    <SearchIcon className="absolute left-4 top-4 text-gray-300 w-6 h-6"/>
                    <button onClick={startVoiceSearch} className={`absolute right-3 top-3 p-1.5 rounded-xl transition-colors ${isRecording ? 'bg-red-100 text-red-500' : 'text-gray-300 hover:text-purple-600 hover:bg-purple-50'}`}>
                        <MicIcon className="w-5 h-5"/>
                    </button>
                 </div>
             </div>
             
             {/* AI Discovery */}
             {userLocation && (
               <div className="space-y-4">
                 <button onClick={discoverNewLeads} disabled={isDiscovering} className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black rounded-2xl shadow-lg shadow-purple-200 uppercase tracking-widest text-[10px] flex justify-center items-center gap-2 hover:opacity-90 transition-opacity">
                     {isDiscovering ? <RefreshIcon className="animate-spin w-4 h-4"/> : <GlobeIcon className="w-4 h-4"/>} 
                     {isDiscovering ? 'Analisi del territorio in corso...' : 'Trova Nuovi Clienti con IA'}
                 </button>
                 {discoveryResults.length > 0 && (
                     <div className="bg-white p-6 rounded-3xl shadow-sm border border-purple-100">
                        <h3 className="font-black text-purple-900 mb-2 text-sm uppercase tracking-widest">Risultati IA</h3>
                        {discoveryResults.map((res, i) => (
                             <p key={i} className="text-sm text-gray-600 leading-relaxed">{res.text}</p>
                        ))}
                     </div>
                 )}
               </div>
             )}

             {/* Clients Grid */}
             <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                 {filteredClients.map(client => (
                     <div key={client.id} onClick={() => setSelectedClient(client)} className="group bg-white p-5 rounded-3xl shadow-sm border border-gray-50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden">
                         <div className="flex items-start gap-4">
                             <div className="w-14 h-14 bg-gray-50 rounded-2xl flex-shrink-0 flex items-center justify-center font-black text-xl text-gray-300 overflow-hidden">
                                 {client.logo ? <img src={client.logo} className="w-full h-full object-cover"/> : client.companyName[0]}
                             </div>
                             <div className="min-w-0 flex-1">
                                 <h3 className="font-bold text-gray-900 truncate pr-6">{client.companyName}</h3>
                                 <p className="text-xs font-medium text-gray-400 truncate">{client.firstName} {client.lastName}</p>
                                 <div className="flex items-center gap-1 mt-2 text-[10px] font-bold text-gray-300 uppercase tracking-wider">
                                     <MapPinIcon className="w-3 h-3"/> {client.address.city}
                                 </div>
                             </div>
                         </div>
                         {/* Badges */}
                         <div className="flex gap-2 mt-4">
                             {client.transactions.some(t => t.type === 'dare') && <span className="px-2 py-1 bg-orange-50 text-orange-600 rounded-lg text-[10px] font-black uppercase">Dare</span>}
                             {client.reminders.some(r => !r.completed) && <span className="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-black uppercase">Avvisi</span>}
                         </div>
                         <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                             <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                         </div>
                     </div>
                 ))}
             </div>
          </div>
        )}

        {activeTab === 'map' && (
             <div className="h-[75vh] bg-gray-200 rounded-[2.5rem] relative overflow-hidden border border-gray-300 shadow-inner group"
                  onMouseDown={handleMapMouseDown} 
                  onMouseMove={handleMapMouseMove} 
                  onMouseUp={handleMapMouseUp}
                  onMouseLeave={handleMapMouseUp}
             >
                 {/* Map Content */}
                 <div style={{ transform: `scale(${mapZoom}) translate(${mapOffset.x}px, ${mapOffset.y}px)`, transition: isDragging ? 'none' : 'transform 0.2s' }} className="w-full h-full absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing">
                      <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                          <GlobeIcon className="w-[800px] h-[800px] text-gray-400"/>
                      </div>
                      
                      {/* User Location */}
                      {userLocation && (
                          <div className="absolute z-20 flex flex-col items-center">
                              <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>
                              <div className="bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full font-bold mt-1 shadow-sm">TU</div>
                          </div>
                      )}

                      {/* Client Pins */}
                      {filteredClients.map(c => {
                          const latDiff = (c.coords.lat - (userLocation?.lat || 41.9)) * 4000;
                          const lngDiff = (c.coords.lng - (userLocation?.lng || 12.4)) * 4000;
                          
                          // Hide if Radar is active and client is out of range
                          if (isRadarActive && userLocation) {
                             const dist = calculateDistance(userLocation, c.coords);
                             if (dist > radarRange) return null;
                          }

                          return (
                              <div key={c.id} 
                                   className="absolute flex flex-col items-center group/pin z-10 hover:z-50 cursor-pointer transition-all hover:scale-125"
                                   style={{ transform: `translate(${lngDiff}px, ${-latDiff}px)` }}
                                   onClick={(e) => { e.stopPropagation(); setSelectedClient(c); }}
                              >
                                  <MapPinIcon className={`w-8 h-8 drop-shadow-md transition-colors ${isRadarActive ? 'text-green-500' : 'text-purple-600'}`}/>
                                  <div className="bg-white px-2 py-1 rounded-lg shadow-md text-[8px] font-black text-gray-800 whitespace-nowrap opacity-0 group-hover/pin:opacity-100 transition-opacity absolute top-8 pointer-events-none">
                                      {c.companyName}
                                  </div>
                              </div>
                          );
                      })}
                 </div>

                 {/* Radar Control Panel */}
                 <div className="absolute top-6 left-6 z-40 flex flex-col gap-2">
                     <button onClick={() => setIsRadarActive(!isRadarActive)} className={`px-4 py-3 rounded-2xl shadow-lg font-black text-xs uppercase tracking-widest transition-all ${isRadarActive ? 'bg-green-500 text-white' : 'bg-white text-gray-700 hover:text-purple-600'}`}>
                         {isRadarActive ? 'Radar Attivo' : 'Attiva Radar Vicinanze'}
                     </button>
                     {isRadarActive && (
                         <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-gray-100 animate-in slide-in-from-left duration-300 w-64">
                             <div className="flex justify-between items-center mb-2">
                                 <span className="text-[10px] font-black uppercase text-gray-400">Raggio Ricerca</span>
                                 <span className="text-sm font-black text-green-600">{radarRange} km</span>
                             </div>
                             <input type="range" min="5" max="100" step="5" value={radarRange} onChange={e => setRadarRange(Number(e.target.value))} className="w-full accent-green-500 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
                             
                             <div className="mt-4 max-h-48 overflow-y-auto custom-scrollbar space-y-2">
                                 {nearbyClients.length === 0 ? (
                                     <p className="text-[10px] text-gray-400 font-bold text-center py-2">Nessun cliente in zona</p>
                                 ) : (
                                     nearbyClients.map(c => (
                                         <div key={c.id} onClick={() => setSelectedClient(c)} className="p-2 rounded-xl hover:bg-green-50 cursor-pointer flex justify-between items-center group">
                                             <div>
                                                 <p className="font-bold text-xs text-gray-800 truncate w-32">{c.companyName}</p>
                                                 <p className="text-[9px] text-gray-400">{c.address.city}</p>
                                             </div>
                                             <div className="text-right">
                                                 <span className="block font-black text-[10px] text-green-600">{(c as any).distance.toFixed(1)} km</span>
                                                 <button className="text-[9px] text-blue-500 hover:underline" onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.address.street + ' ' + c.address.city)}`); }}>Vai</button>
                                             </div>
                                         </div>
                                     ))
                                 )}
                             </div>
                         </div>
                     )}
                 </div>

                 {/* Map Controls */}
                 <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                     <button onClick={handleZoomIn} className="p-3 bg-white rounded-2xl shadow-xl text-gray-700 hover:bg-gray-50 hover:text-purple-600 transition-colors"><PlusIcon className="w-6 h-6"/></button>
                     <button onClick={handleZoomOut} className="p-3 bg-white rounded-2xl shadow-xl text-gray-700 hover:bg-gray-50 hover:text-purple-600 transition-colors"><MinusIcon className="w-6 h-6"/></button>
                     <button onClick={handleResetMap} className="p-3 bg-white rounded-2xl shadow-xl text-gray-700 hover:bg-gray-50 hover:text-purple-600 transition-colors"><MaximizeIcon className="w-6 h-6"/></button>
                 </div>
             </div>
        )}

        {activeTab === 'tour' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             {/* Sub Tabs */}
             <div className="flex justify-center">
                 <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 inline-flex">
                     {['planned', 'history', 'calendar'].map((t) => (
                         <button 
                            key={t} 
                            onClick={() => setTourSubTab(t as any)}
                            className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tourSubTab === t ? 'bg-purple-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                         >
                             {t === 'planned' ? 'Pianificati' : t === 'history' ? 'Storico' : 'Calendario'}
                         </button>
                     ))}
                 </div>
             </div>

             {tourSubTab === 'calendar' ? <CalendarView /> : (
                 <div className="space-y-6">
                     {/* Create New Tour */}
                     {tourSubTab === 'planned' && (
                         <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                             <div className="flex justify-between items-center mb-4">
                                <h3 className="font-black text-gray-900 flex items-center gap-2"><MapPinIcon className="w-5 h-5 text-purple-600"/> Pianifica Percorso</h3>
                                <button onClick={() => setShowTourGuide(!showTourGuide)} className="text-purple-600 text-xs font-bold underline hover:text-purple-800">
                                    {showTourGuide ? 'Chiudi Guida' : 'Come funziona?'}
                                </button>
                             </div>

                             {showTourGuide && (
                                <div className="bg-purple-50 p-4 rounded-2xl mb-4 text-sm text-purple-900 border border-purple-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="font-black mb-2 uppercase tracking-widest text-[10px]">Guida Rapida: Pianificazione</h4>
                                    <ol className="list-decimal pl-4 space-y-1">
                                        <li><strong>Scegli la data:</strong> Usa il selettore qui sotto per impostare il giorno del giro visite.</li>
                                        <li><strong>Definisci Partenza:</strong> Scegli se partire dalla tua posizione o da un cliente (es. ufficio).</li>
                                        <li><strong>Seleziona i Clienti:</strong> Clicca sul tasto per aprire la lista clienti e seleziona chi visitare.</li>
                                        <li><strong>Genera:</strong> Premi il pulsante finale per creare l'itinerario ottimizzato.</li>
                                    </ol>
                                </div>
                             )}

                             {/* Start Point Selection */}
                             <div className="mb-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Punto di Partenza (per calcolo percorso)</label>
                                 <div className="flex gap-2 mb-3">
                                     <button 
                                        onClick={() => setStartPointType('gps')}
                                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${startPointType === 'gps' ? 'bg-white border-purple-300 text-purple-600 shadow-sm' : 'border-transparent text-gray-400 hover:bg-gray-100'}`}
                                     >
                                         La mia posizione
                                     </button>
                                     <button 
                                        onClick={() => setStartPointType('client')}
                                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${startPointType === 'client' ? 'bg-white border-purple-300 text-purple-600 shadow-sm' : 'border-transparent text-gray-400 hover:bg-gray-100'}`}
                                     >
                                         Da un Cliente/Sede
                                     </button>
                                 </div>
                                 
                                 {startPointType === 'client' && (
                                     <select 
                                        value={startPointClientId} 
                                        onChange={e => setStartPointClientId(e.target.value)}
                                        className="w-full bg-white p-3 rounded-xl font-bold outline-none border border-gray-200 text-sm"
                                     >
                                         <option value="">-- Seleziona punto di partenza --</option>
                                         {clients.map(c => (
                                             <option key={c.id} value={c.id}>{c.companyName} ({c.address.city})</option>
                                         ))}
                                     </select>
                                 )}
                             </div>

                             {/* Date Picker */}
                             <div className="mb-4">
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Data del Tour</label>
                                <input 
                                    type="date" 
                                    value={tourDate}
                                    onChange={(e) => setTourDate(e.target.value)}
                                    className="w-full bg-gray-50 p-3 rounded-xl font-bold outline-none border border-gray-100 text-sm focus:ring-2 focus:ring-purple-100"
                                />
                             </div>

                             {/* Client Selection Area - REPLACED */}
                             <div className="bg-purple-50 rounded-2xl p-6 mb-6 border border-purple-100 flex flex-col items-center justify-center text-center gap-3">
                                {clients.length === 0 ? (
                                    <>
                                        <div className="p-3 bg-white rounded-full text-purple-200 shadow-sm">
                                            <FileIcon className="w-8 h-8"/>
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-500 text-sm">Lista Clienti Vuota</p>
                                            <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] mx-auto leading-tight">Crea prima le schede cliente per poter pianificare un tour.</p>
                                        </div>
                                        <button onClick={() => setActiveTab('add')} className="mt-2 px-6 py-3 bg-white border border-gray-200 shadow-sm rounded-xl text-[10px] font-black uppercase tracking-widest text-purple-600 hover:bg-purple-50 transition-colors">
                                            + Aggiungi Nuovo Cliente
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-4xl font-black text-purple-600">{tourSelection.length}</span>
                                            <span className="text-xs font-bold text-purple-400 uppercase tracking-widest text-left leading-tight">Clienti<br/>Selezionati</span>
                                        </div>
                                        {tourSelection.length > 0 && (
                                            <div className="flex gap-1 mb-2">
                                                {tourSelection.slice(0, 3).map(id => {
                                                    const c = clients.find(cl => cl.id === id);
                                                    return (
                                                        <div key={id} className="w-6 h-6 rounded-full bg-purple-200 border-2 border-white flex items-center justify-center text-[8px] font-black text-purple-700">
                                                            {c?.companyName[0]}
                                                        </div>
                                                    );
                                                })}
                                                {tourSelection.length > 3 && <div className="w-6 h-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-gray-400">+{tourSelection.length - 3}</div>}
                                            </div>
                                        )}
                                        <button 
                                            onClick={() => setActiveTab('tour_selection')} 
                                            className="w-full py-4 bg-white border-2 border-purple-600 text-purple-600 font-black rounded-xl text-[12px] uppercase tracking-widest hover:bg-purple-600 hover:text-white transition-all shadow-md flex items-center justify-center gap-2"
                                        >
                                           <CheckIcon className="w-5 h-5"/> AGGIUNGI CLIENTI AL TOUR
                                        </button>
                                    </>
                                )}
                             </div>

                             <button onClick={createTour} disabled={tourSelection.length === 0} className="w-full py-4 bg-gray-900 text-white font-black rounded-xl text-[10px] uppercase tracking-widest disabled:opacity-50 hover:bg-black transition-colors shadow-lg">Genera Itinerario Ottimizzato</button>
                         </div>
                     )}

                     {/* Tour List */}
                     <div className="space-y-4">
                        {filteredTours.map(tour => (
                             <div key={tour.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-50 relative overflow-hidden">
                                 <div className="flex justify-between items-start mb-6 relative z-10">
                                     <div>
                                         <h3 className="font-black text-lg text-gray-900">{tour.name}</h3>
                                         <p className="text-xs text-gray-400 font-bold">{new Date(tour.date).toLocaleDateString()}</p>
                                     </div>
                                     <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${tour.status === 'completed' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                                         {tour.status === 'planned' ? 'In Programma' : 'Completato'}
                                     </span>
                                 </div>
                                 <div className="space-y-6 relative z-10">
                                     {tour.stops.map((stop, idx) => {
                                         const c = clients.find(cl => cl.id === stop.clientId);
                                         if(!c) return null;
                                         return (
                                             <div key={idx} 
                                                  onClick={() => setSelectedTourStop(c)}
                                                  className="flex gap-4 relative group cursor-pointer"
                                             >
                                                 <div className="flex flex-col items-center">
                                                     <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white font-black text-xs shadow-md z-10">{idx + 1}</div>
                                                     {idx < tour.stops.length - 1 && <div className="w-0.5 h-full bg-purple-100 absolute top-8"></div>}
                                                 </div>
                                                 <div className="flex-1 bg-gray-50 p-4 rounded-2xl border border-gray-100 transition-all hover:bg-purple-50 hover:border-purple-100">
                                                     <div className="font-bold text-gray-800 text-sm">{c.companyName}</div>
                                                     <div className="text-xs text-gray-500 mt-0.5">{c.address.street}, {c.address.city}</div>
                                                     <div className="mt-2 flex gap-2">
                                                         <button className="bg-white p-2 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors" onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.address.street + ' ' + c.address.city)}`)}}><MapPinIcon className="w-4 h-4"/></button>
                                                         <button className="bg-white p-2 rounded-lg text-green-500 hover:bg-green-50 transition-colors" onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${c.phone}`}}><PhoneIcon className="w-4 h-4"/></button>
                                                     </div>
                                                 </div>
                                             </div>
                                         );
                                     })}
                                 </div>
                             </div>
                         ))}
                     </div>
                 </div>
             )}
          </div>
        )}

        {/* NEW: Full Screen Selection View */}
        {activeTab === 'tour_selection' && (
            <div className="fixed inset-0 bg-white z-[60] flex flex-col animate-in slide-in-from-bottom duration-300">
                <div className="px-6 py-6 border-b border-gray-100 bg-white flex justify-between items-center shadow-sm">
                    <h2 className="text-xl font-black text-gray-800 tracking-tighter uppercase">Seleziona Clienti</h2>
                    <div className="flex gap-3">
                         <div className="bg-purple-50 px-3 py-1 rounded-lg text-purple-600 font-black text-xs">
                             {tourSelection.length} Scelti
                         </div>
                         <button onClick={() => setTourSelection([])} className="text-xs font-bold text-red-400 hover:text-red-600">Reset</button>
                    </div>
                </div>
                
                <div className="p-4 bg-gray-50">
                    <div className="relative">
                        <input 
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Cerca cliente da aggiungere..." 
                            className="w-full bg-white p-3 pl-10 rounded-xl shadow-sm border border-gray-200 outline-none font-bold text-gray-700 placeholder:text-gray-300"
                        />
                        <SearchIcon className="absolute left-3 top-3.5 text-gray-300 w-5 h-5"/>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-32">
                    {filteredClients.map(c => {
                        const isSelected = tourSelection.includes(c.id);
                        return (
                            <div 
                                key={c.id} 
                                onClick={() => {
                                    if(isSelected) setTourSelection(p => p.filter(id => id !== c.id));
                                    else setTourSelection(p => [...p, c.id]);
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${isSelected ? 'bg-purple-600 border-purple-600 shadow-lg transform scale-[1.02]' : 'bg-white border-gray-100 hover:border-purple-200'}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${isSelected ? 'bg-white text-purple-600' : 'bg-gray-100 text-gray-400'}`}>
                                        {c.companyName[0]}
                                    </div>
                                    <div>
                                        <h3 className={`font-bold ${isSelected ? 'text-white' : 'text-gray-800'}`}>{c.companyName}</h3>
                                        <p className={`text-xs ${isSelected ? 'text-purple-200' : 'text-gray-400'}`}>{c.address.city}</p>
                                    </div>
                                </div>
                                {isSelected ? (
                                    <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-purple-600">
                                        <CheckIcon className="w-4 h-4"/>
                                    </div>
                                ) : (
                                    <div className="w-6 h-6 rounded-full border-2 border-gray-200"></div>
                                )}
                            </div>
                        );
                    })}
                    {filteredClients.length === 0 && (
                        <div className="text-center py-10 text-gray-400 text-sm">Nessun cliente trovato.</div>
                    )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-100 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
                    <button onClick={() => setActiveTab('tour')} className="w-full py-4 bg-gray-900 text-white font-black rounded-2xl text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all">
                        CONFERMA SELEZIONE ({tourSelection.length})
                    </button>
                </div>
            </div>
        )}

        {activeTab === 'add' && <ClientForm />}

        {activeTab === 'settings' && <SettingsView />}

      </div>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-200 px-6 py-2 pb-6 md:pb-2 z-50 flex justify-around items-center">
           <NavButton icon={<FileIcon/>} label="Clienti" active={activeTab === 'list'} onClick={() => setActiveTab('list')} />
           <NavButton icon={<MapPinIcon/>} label="Mappa" active={activeTab === 'map'} onClick={() => setActiveTab('map')} />
           <div className="-mt-12">
               <button 
                  onClick={() => {
                      if (activeTab === 'tour') setActiveTab('tour_selection');
                      else setActiveTab('add');
                  }} 
                  className={`p-4 rounded-full shadow-2xl transition-transform hover:scale-105 active:scale-95 ${activeTab === 'add' || activeTab === 'tour_selection' ? 'bg-purple-600 text-white ring-4 ring-purple-100' : 'bg-gray-900 text-white'}`}
               >
                  <PlusIcon className="w-8 h-8"/>
               </button>
           </div>
           <NavButton icon={<CalendarIcon/>} label="Tour" active={activeTab === 'tour' || activeTab === 'tour_selection'} onClick={() => setActiveTab('tour')} />
           <NavButton icon={<SettingsIcon/>} label="Menu" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </nav>

      {/* Detail Modal */}
      {selectedClient && (
           <div className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-in fade-in duration-200">
               <div className="bg-white w-full md:w-[500px] h-[85vh] md:h-auto md:max-h-[85vh] rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom duration-300">
                   
                   {/* Modal Header */}
                   <div className="p-6 pb-2 flex justify-between items-center border-b border-gray-50 bg-white z-10">
                       <h2 className="font-black text-xl text-gray-800 truncate pr-4">{selectedClient.companyName}</h2>
                       <button onClick={() => setSelectedClient(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 text-gray-600"><MinusIcon className="w-6 h-6"/></button>
                   </div>
                   
                   {/* Modal Content */}
                   <div className="overflow-y-auto p-6 space-y-6 bg-white flex-1">
                       <div className="flex items-center gap-5">
                           <div className="w-20 h-20 bg-gray-100 rounded-3xl overflow-hidden shadow-inner flex-shrink-0">
                                {selectedClient.logo ? <img src={selectedClient.logo} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center font-black text-gray-300 text-2xl">{selectedClient.companyName[0]}</div>}
                           </div>
                           <div>
                               <p className="font-bold text-gray-900">{selectedClient.firstName} {selectedClient.lastName}</p>
                               <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wider">{selectedClient.address.city}</p>
                           </div>
                       </div>

                       {/* Quick Actions */}
                       <div className="grid grid-cols-3 gap-3">
                           <a href={`https://wa.me/${selectedClient.phone.replace(/[^0-9]/g, '')}`} target="_blank" className="flex flex-col items-center justify-center gap-1 py-3 bg-green-50 text-green-600 rounded-2xl hover:bg-green-100 transition-colors">
                               <WhatsAppIcon className="w-6 h-6"/>
                               <span className="text-[10px] font-black uppercase">WhatsApp</span>
                           </a>
                           <a href={`tel:${selectedClient.phone}`} className="flex flex-col items-center justify-center gap-1 py-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition-colors">
                               <PhoneIcon className="w-6 h-6"/>
                               <span className="text-[10px] font-black uppercase">Chiama</span>
                           </a>
                           <a href={`mailto:${selectedClient.email}`} className="flex flex-col items-center justify-center gap-1 py-3 bg-orange-50 text-orange-600 rounded-2xl hover:bg-orange-100 transition-colors">
                               <MailIcon className="w-6 h-6"/>
                               <span className="text-[10px] font-black uppercase">Email</span>
                           </a>
                       </div>

                       {/* Address */}
                       <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                           <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2"><MapPinIcon className="w-4 h-4"/> Sede</h3>
                           <p className="font-bold text-gray-800 text-sm">{selectedClient.address.street} {selectedClient.address.number}</p>
                           <p className="text-xs text-gray-500 mt-1">{selectedClient.address.zip} {selectedClient.address.city} ({selectedClient.address.region})</p>
                           <button onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedClient.address.street + ' ' + selectedClient.address.city)}`)} className="mt-4 w-full py-3 bg-white border border-gray-200 text-gray-800 font-black text-[10px] rounded-xl uppercase tracking-widest hover:bg-gray-100 shadow-sm">Apri in Maps</button>
<button 
  onClick={() => {
    setActiveTab('add');
    window.scrollTo(0, 0);
  }}
  className="mt-4 w-full py-3 bg-purple-600 text-white font-bold rounded-xl uppercase tracking-widest hover:bg-purple-700 shadow-sm"
>
  ✏️ MODIFICA SCHEDA
</button>

                       </div>

                       {/* Files */}
                       <div>
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><FileIcon className="w-4 h-4"/> Documenti</h3>
                                <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold text-purple-600 bg-purple-50 px-3 py-1 rounded-lg hover:bg-purple-100">Aggiungi +</button>
                                <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileUpload} />
                            </div>
                            {selectedClient.files && selectedClient.files.length > 0 ? (
                                <div className="grid grid-cols-3 gap-3">
                                    {selectedClient.files.map(f => (
                                        <div key={f.id} onClick={() => {}} className="aspect-square bg-gray-100 rounded-xl overflow-hidden relative group border border-gray-200">
                                            {f.type.startsWith('image/') ? <img src={f.content} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center"><FileIcon className="text-gray-400"/></div>}
                                            <a href={f.content} download={f.name} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <DownloadIcon className="text-white w-6 h-6"/>
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-xs text-gray-400 italic bg-gray-50 rounded-2xl border border-dashed border-gray-200">Nessun file archiviato</div>
                            )}
                       </div>
                       
                       <div className="pt-4 mt-4 border-t border-gray-100">
                           <button onClick={() => deleteClient(selectedClient.id)} className="w-full py-4 text-red-500 font-black text-xs uppercase tracking-widest hover:bg-red-50 rounded-2xl transition-colors">Elimina Definitivamente</button>
                       </div>
                   </div>
               </div>
           </div>
       )}
       
       {/* NEW: Tour Stop Mini Modal */}
       {selectedTourStop && (
           <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setSelectedTourStop(null)}>
               <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                   <button onClick={() => setSelectedTourStop(null)} className="absolute top-4 right-4 p-2 bg-gray-50 rounded-full text-gray-400 hover:bg-gray-100">
                       <XIcon className="w-5 h-5"/>
                   </button>
                   
                   <div className="flex flex-col items-center text-center">
                       <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 font-black text-2xl mb-4 overflow-hidden border border-purple-100">
                           {selectedTourStop.logo ? <img src={selectedTourStop.logo} className="w-full h-full object-cover"/> : selectedTourStop.companyName[0]}
                       </div>
                       
                       <h3 className="text-xl font-black text-gray-900 leading-tight mb-1">{selectedTourStop.companyName}</h3>
                       <p className="text-sm font-medium text-gray-400">{selectedTourStop.firstName} {selectedTourStop.lastName}</p>
                       
                       <div className="w-full bg-gray-50 p-4 rounded-2xl mt-5 border border-gray-100 text-left">
                           <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1"><MapPinIcon className="w-3 h-3"/> Indirizzo</p>
                           <p className="font-bold text-gray-800 text-sm leading-snug">{selectedTourStop.address.street} {selectedTourStop.address.number}</p>
                           <p className="text-xs text-gray-500 mt-0.5">{selectedTourStop.address.zip} {selectedTourStop.address.city} ({selectedTourStop.address.region})</p>
                       </div>
                       
                       <button 
                           onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedTourStop.address.street + ' ' + selectedTourStop.address.city)}`)}
                           className="w-full py-4 bg-blue-600 text-white font-black rounded-xl text-xs uppercase tracking-widest mt-6 shadow-lg hover:bg-blue-700 flex items-center justify-center gap-2 transition-all active:scale-95"
                       >
                           <MapPinIcon className="w-4 h-4"/> Avvia Navigazione
                       </button>
                   </div>
               </div>
           </div>
       )}

    </div>
  );
};

// Helper Component for Nav
const NavButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1 group">
        <div className={`p-1.5 rounded-xl transition-colors ${active ? 'text-purple-600' : 'text-gray-300 group-hover:text-gray-500'}`}>
            {React.cloneElement(icon as any, { className: "w-6 h-6" })}
        </div>
        <span className={`text-[10px] font-bold ${active ? 'text-purple-600' : 'text-gray-300 group-hover:text-gray-500'}`}>{label}</span>
    </button>
);

export default App;
