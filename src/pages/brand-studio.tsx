'use client';

import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { Palette, Loader, Download } from 'lucide-react';

export default function BrandStudioPage() {
  const [user, setUser] = useState<any>(null);
  const [productName, setProductName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<any>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      }
    };

    fetchUser();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    // Simulation - replace with real API call
    setTimeout(() => {
      setAssets({
        website: '<html>...</html>',
        images: Array(9).fill('image.png'),
        videos: Array(3).fill('video.mp4'),
        copy: 'Discover the perfect product that transforms your daily life...',
        psychometrics: ['scarcity', 'social_proof', 'urgency'],
        qualityScore: 8.7,
      });
      setGenerating(false);
    }, 3000);
  };

  return (
    <Layout user={user}>
      <div>
        <h1 className="text-4xl font-bold text-white mb-8">Brand Studio</h1>

        {/* Input Section */}
        <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Generate Brand Assets</h2>
          <p className="text-gray-400 text-sm mb-6">
            AI-powered creative generation with 42 psychometric models
          </p>
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="Enter product name..."
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              onClick={handleGenerate}
              disabled={generating || !productName}
              className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg transition"
            >
              {generating ? <Loader className="animate-spin" size={20} /> : <Palette size={20} />}
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Assets Preview */}
        {assets && (
          <div className="space-y-6">
            {/* Quality Score */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white mb-2">Generation Quality</h3>
                  <p className="text-gray-400 text-sm">Score: {assets.qualityScore}/10</p>
                </div>
                <div className="text-4xl font-bold text-emerald-500">{assets.qualityScore}</div>
              </div>
            </div>

            {/* Generated Copy */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Generated Copy</h3>
              <p className="text-gray-300 leading-relaxed mb-4">{assets.copy}</p>
              <button className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300">
                <Download size={16} /> Copy to Clipboard
              </button>
            </div>

            {/* Psychometric Models */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Applied Psychometric Models</h3>
              <div className="flex flex-wrap gap-2">
                {assets.psychometrics.map((model: string, i: number) => (
                  <span key={i} className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-sm">
                    {model}
                  </span>
                ))}
              </div>
            </div>

            {/* Generated Images */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Generated Images (9)</h3>
              <div className="grid grid-cols-3 gap-4">
                {assets.images.map((img: string, i: number) => (
                  <div key={i} className="bg-slate-800 rounded-lg h-32 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">Image {i + 1}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Generated Videos */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Generated Videos (3 × 15s)</h3>
              <div className="grid grid-cols-3 gap-4">
                {assets.videos.map((video: string, i: number) => (
                  <div key={i} className="bg-slate-800 rounded-lg h-32 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">Video {i + 1}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Launch Campaign */}
            <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-lg transition">
              Launch Campaign with These Assets
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
