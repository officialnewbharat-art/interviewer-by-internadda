import React, { useState } from 'react';
import { CandidateInfo } from '../types';

interface CandidateFormProps {
  onSubmit: (info: CandidateInfo) => void;
}

const PREDEFINED_ROLES = [
  "Frontend Engineer", 
  "Backend Engineer", 
  "Full Stack Developer", 
  "DevOps Engineer", 
  "Data Scientist",
  "Product Manager",
  "QA Engineer"
];

const LANGUAGES = [
  "English", 
  "Spanish", 
  "French", 
  "German", 
  "Hindi",
  "Japanese"
];

export const CandidateForm: React.FC<CandidateFormProps> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [field, setField] = useState('');
  const [language, setLanguage] = useState('English');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); // Page refresh rokta hai
    
    // Debugging ke liye
    console.log("Submitting:", { name, field, language, jobDescription });

    if (name.trim() && jobDescription.trim() && field && language) {
        onSubmit({ name, jobDescription, field, language });
    } else {
        alert("Please fill in all fields:\n- Name\n- Role\n- Job Description");
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 h-full w-full">
      
      {/* Left Panel: Branding */}
      <div className="lg:col-span-5 bg-slate-900 relative overflow-hidden flex flex-col justify-end lg:justify-center p-8 pt-24 lg:p-20 text-white min-h-[30vh] lg:min-h-0 shrink-0">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-slate-950 to-slate-950"></div>
        
        <div className="relative z-10 space-y-6">
           <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm w-fit">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest">Powered by Internadda</span>
           </div>
           
           <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-tight">
             Meet <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Interna</span>
           </h1>
           
           <p className="text-xl lg:text-2xl font-light text-slate-200">
             Your AI Interviewer Agent.
           </p>
           
           <p className="text-sm text-slate-400 max-w-md hidden lg:block">
             Conduct realistic voice interviews tailored to specific job descriptions.
           </p>
        </div>
      </div>

      {/* Right Panel: Form */}
      <div className="lg:col-span-7 bg-white flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 p-6 md:p-12 lg:p-24 flex flex-col justify-center">
            <div className="max-w-xl w-full mx-auto">
                <div className="mb-10">
                    <h2 className="text-2xl font-bold text-slate-900">Setup Interview</h2>
                    <p className="text-slate-500 mt-2">Configure Interna with the candidate context.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Name Input */}
                        <div className="group">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Candidate Name</label>
                            <input 
                                type="text" 
                                required 
                                className="w-full px-0 py-2 border-b-2 border-slate-200 focus:border-indigo-600 outline-none transition-colors bg-transparent text-lg font-medium text-slate-900 placeholder:text-slate-300" 
                                placeholder="Enter full name"
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                            />
                        </div>

                        {/* Language Selection */}
                        <div className="group">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Language</label>
                            <select 
                                className="w-full px-0 py-2 border-b-2 border-slate-200 focus:border-indigo-600 outline-none transition-colors bg-transparent text-lg font-medium text-slate-900" 
                                value={language} 
                                onChange={(e) => setLanguage(e.target.value)}
                            >
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                    </div>
                    
                    {/* Role Selection */}
                    <div className="group">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Target Role</label>
                        <select 
                            required
                            className="w-full px-0 py-2 border-b-2 border-slate-200 focus:border-indigo-600 outline-none transition-colors bg-transparent text-lg font-medium text-slate-900" 
                            value={field} 
                            onChange={(e) => setField(e.target.value)}
                        >
                            <option value="" disabled>Select a role...</option>
                            {PREDEFINED_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>

                    {/* Job Description */}
                    <div className="group">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Job Description</label>
                        <textarea 
                            required
                            rows={4}
                            className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-indigo-600 focus:bg-white outline-none transition-all text-sm resize-none"
                            placeholder="Paste the JD here..."
                            value={jobDescription}
                            onChange={(e) => setJobDescription(e.target.value)}
                        />
                    </div>

                    {/* Submit Button */}
                    <div className="pt-6">
                        <button 
                            type="submit" 
                            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 transition-all flex items-center justify-between px-6 shadow-xl cursor-pointer"
                        >
                            <span>Initialize Interna</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>

                </form>
            </div>
        </div>
      </div>
    </div>
  );
};
