import React, { useState } from 'react';
import { CandidateInfo } from '../types';

interface CandidateFormProps {
  onSubmit: (info: CandidateInfo) => void;
}

const PREDEFINED_ROLES = [ "Frontend Engineer", "Backend Engineer", "Full Stack Developer", "DevOps Engineer", "Data Scientist" ];
const LANGUAGES = [ "English", "Spanish", "French", "German", "Hindi" ];

export const CandidateForm: React.FC<CandidateFormProps> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [field, setField] = useState('');
  const [language, setLanguage] = useState('English');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && jobDescription && field && language) onSubmit({ name, jobDescription, field, language });
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 h-full w-full animate-fade-in">
      {/* Left Panel */}
      <div className="lg:col-span-5 bg-slate-900 relative overflow-hidden flex flex-col justify-end lg:justify-center p-8 pt-24 lg:p-20 text-white min-h-[30vh] lg:min-h-0 shrink-0">
        <div className="relative z-10 space-y-4 lg:space-y-6">
           <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm w-fit">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-[10px] lg:text-xs font-bold uppercase tracking-widest">Powered by Internadda</span>
           </div>
           
           <h1 className="text-3xl md:text-4xl lg:text-6xl font-bold tracking-tight leading-tight">
             Meet <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Interna</span>.
           </h1>
           
           <p className="text-xl md:text-2xl lg:text-3xl font-light text-slate-200 leading-tight">
             Your AI Interviewer Agent from Internadda.
           </p>
           
           <p className="text-sm lg:text-lg text-slate-400 max-w-md leading-relaxed hidden md:block">
             Conduct realistic voice interviews tailored to specific job descriptions.
           </p>
        </div>
      </div>

      {/* Right Panel: Form */}
      <div className="lg:col-span-7 bg-white flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 p-6 md:p-12 lg:p-24">
            <div className="max-w-xl w-full mx-auto">
            <div className="mb-8 lg:mb-10">
                <h2 className="text-xl lg:text-2xl font-bold text-slate-900">Candidate Profile</h2>
                <p className="text-sm lg:text-base text-slate-500 mt-2">Configure Interna with the interview context.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 lg:space-y-8">
                {/* ... (Keep existing form fields for Name, Language, Role, JD) ... */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="group">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
                        <input type="text" required className="w-full px-0 py-2 border-b-2" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    {/* ... other inputs ... */}
                </div>
                
                <div className="group">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Role</label>
                    <select className="w-full px-0 py-2 border-b-2" value={field} onChange={(e) => setField(e.target.value)}>
                        <option value="">Select...</option>
                        {PREDEFINED_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>

                <div className="pt-4 lg:pt-6 pb-8">
                <button type="submit" className="group w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 transition-all flex items-center justify-between px-6">
                    <span>Initialize Interna</span>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 group-hover:translate-x-1">
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
