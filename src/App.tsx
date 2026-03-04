import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Send, 
  Download, 
  FileText, 
  Menu,
  X,
  Bot,
  User
} from 'lucide-react';
import Markdown from 'react-markdown';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type Conversation = {
  id: number;
  title: string;
  created_at: string;
};

type Message = {
  id: number;
  conversation_id: number;
  role: 'user' | 'model';
  content: string;
  created_at: string;
};

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (currentConversation) {
      fetchMessages(currentConversation.id);
    } else {
      setMessages([]);
    }
  }, [currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data);
      if (data.length > 0 && !currentConversation) {
        setCurrentConversation(data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const fetchMessages = async (id: number) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      const data = await res.json();
      setConversations([data, ...conversations]);
      setCurrentConversation(data);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      const updated = conversations.filter(c => c.id !== id);
      setConversations(updated);
      if (currentConversation?.id === id) {
        setCurrentConversation(updated.length > 0 ? updated[0] : null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const saveMessage = async (conversationId: number, role: string, content: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content }),
      });
      return await res.json();
    } catch (error) {
      console.error('Failed to save message:', error);
      return null;
    }
  };

  const updateConversationTitle = async (id: number, firstMessage: string) => {
    // Optional: Update title based on first message
    const title = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
    // We could add a PUT endpoint for this, but for now we'll just leave it as "New Conversation"
    // or we can just update the local state if we had a PUT endpoint.
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    let activeConv = currentConversation;
    if (!activeConv) {
      // Create a new conversation if none exists
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.substring(0, 30) + (input.length > 30 ? '...' : '') }),
      });
      activeConv = await res.json();
      setConversations(prev => [activeConv!, ...prev]);
      setCurrentConversation(activeConv);
    }

    const userMessageContent = input.trim();
    setInput('');
    setIsLoading(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: Date.now(),
      conversation_id: activeConv!.id,
      role: 'user',
      content: userMessageContent,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    // Save user message to DB
    await saveMessage(activeConv!.id, 'user', userMessageContent);

    try {
      // Call Gemini API
      const chatHistory = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      // We use generateContent instead of chats.create to easily pass history and tools
      const historyContents = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));
      
      historyContents.push({
        role: 'user',
        parts: [{ text: userMessageContent }]
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: historyContents,
        config: {
          systemInstruction: "You are an AI assistant named Bahdinan. You are capable of learning and searching for information to answer questions accurately. You are helpful, intelligent, and teach yourself new things when asked.",
          tools: [{ googleSearch: {} }]
        }
      });

      const aiResponseText = response.text || "I'm sorry, I couldn't generate a response.";

      // Save AI message to DB
      const savedAiMsg = await saveMessage(activeConv!.id, 'model', aiResponseText);
      
      if (savedAiMsg) {
        setMessages(prev => [...prev, savedAiMsg]);
      } else {
        // Fallback if DB save fails
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          conversation_id: activeConv!.id,
          role: 'model',
          content: aiResponseText,
          created_at: new Date().toISOString()
        }]);
      }

    } catch (error) {
      console.error('Error generating response:', error);
      const errorMsg = "Sorry, I encountered an error while processing your request.";
      await saveMessage(activeConv!.id, 'model', errorMsg);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        conversation_id: activeConv!.id,
        role: 'model',
        content: errorMsg,
        created_at: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const exportToCSV = async () => {
    try {
      const res = await fetch('/api/export/data');
      const { conversations, messages } = await res.json();
      
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += "Conversation ID,Conversation Title,Message Role,Message Content,Created At\n";
      
      messages.forEach((msg: any) => {
        const conv = conversations.find((c: any) => c.id === msg.conversation_id);
        const title = conv ? conv.title.replace(/"/g, '""') : 'Unknown';
        const content = msg.content.replace(/"/g, '""');
        const row = `${msg.conversation_id},"${title}",${msg.role},"${content}",${msg.created_at}`;
        csvContent += row + "\n";
      });
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "bahdinan_history.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to export CSV:', error);
      alert('Failed to export data.');
    }
  };

  const exportToPDF = async () => {
    try {
      const res = await fetch('/api/export/data');
      const { conversations, messages } = await res.json();
      
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text("Bahdinan AI - Conversation History", 14, 22);
      
      const tableData = messages.map((msg: any) => {
        const conv = conversations.find((c: any) => c.id === msg.conversation_id);
        return [
          conv ? conv.title : 'Unknown',
          msg.role === 'user' ? 'You' : 'Bahdinan',
          msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content,
          new Date(msg.created_at).toLocaleString()
        ];
      });
      
      autoTable(doc, {
        startY: 30,
        head: [['Conversation', 'Sender', 'Message Snippet', 'Date']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 2: { cellWidth: 80 } }
      });
      
      doc.save("bahdinan_history.pdf");
    } catch (error) {
      console.error('Failed to export PDF:', error);
      alert('Failed to export data.');
    }
  };

  return (
    <div className="flex h-screen bg-zinc-50 text-zinc-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <div 
        className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
          fixed inset-y-0 left-0 z-50 w-72 bg-zinc-900 text-zinc-100 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col`}
      >
        <div className="p-4 flex items-center justify-between border-b border-zinc-800">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <Bot className="w-6 h-6 text-emerald-400" />
            <span>Bahdinan AI</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="md:hidden p-1 hover:bg-zinc-800 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <button 
            onClick={createNewConversation}
            className="w-full flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-1">
          {conversations.map(conv => (
            <div 
              key={conv.id}
              onClick={() => setCurrentConversation(conv)}
              className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                currentConversation?.id === conv.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="truncate text-sm">{conv.title}</span>
              </div>
              <button 
                onClick={(e) => deleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 space-y-2">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 px-1">Export Data</div>
          <button 
            onClick={exportToCSV}
            className="w-full flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800 px-3 py-2 rounded-lg transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            Export to Excel (CSV)
          </button>
          <button 
            onClick={exportToPDF}
            className="w-full flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800 px-3 py-2 rounded-lg transition-colors text-sm"
          >
            <FileText className="w-4 h-4" />
            Export to PDF
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header */}
        <header className="h-14 flex items-center px-4 border-b border-zinc-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="md:hidden p-2 -ml-2 mr-2 hover:bg-zinc-100 rounded-lg text-zinc-600"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="font-medium text-zinc-800 truncate">
            {currentConversation?.title || 'New Chat'}
          </h1>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto px-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-6 shadow-sm">
                <Bot className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-semibold text-zinc-800 mb-2">I'm Bahdinan</h2>
              <p className="text-zinc-500 mb-8">
                I can answer questions, search the web to teach myself new things, and keep a history of our conversations that you can export anytime.
              </p>
              <div className="grid gap-2 w-full">
                {["What is the history of the internet?", "Teach yourself about quantum computing", "How do I bake a cake?"].map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(suggestion)}
                    className="text-left px-4 py-3 rounded-xl border border-zinc-200 hover:border-emerald-300 hover:bg-emerald-50 text-sm text-zinc-600 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow-sm ${
                    msg.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-emerald-100 text-emerald-600'
                  }`}>
                    {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-3 rounded-2xl ${
                      msg.role === 'user' 
                        ? 'bg-zinc-800 text-white rounded-tr-sm' 
                        : 'bg-zinc-100 text-zinc-800 rounded-tl-sm'
                    }`}>
                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                      ) : (
                        <div className="prose prose-sm prose-zinc max-w-none">
                          <div className="markdown-body">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-400 mt-1 px-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-sm">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="bg-zinc-100 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-zinc-100">
          <div className="max-w-3xl mx-auto relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Bahdinan anything..."
              className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl pl-4 pr-12 py-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none h-14 min-h-[56px] max-h-32 text-sm transition-all"
              rows={1}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 bottom-2 p-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white rounded-xl transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="text-center mt-2">
            <span className="text-[10px] text-zinc-400">Bahdinan can search the web to learn and answer accurately.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
