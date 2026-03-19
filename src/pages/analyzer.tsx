'use client';

import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { Search, Loader } from 'lucide-react';

export default function AnalyzerPage() {
  const [user, setUser] = useState<any>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

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

  const handleAnalyze = async () => {
    setLoading(true);
    // Simulation - replace with real API call
    setTimeout(() => {
      setResult({
        title: 'Eco-Friendly Product',
        price: 79.99,
        rating: 4.5,
        reviews: 234,
        demandScore: 87,
        profitabilityScore: 78,
        competitorCount: 45,
        radarScore: 82,
      });
      setLoading(false);
    }, 2000);
  };

  return (
    <Layout user={user}>
      <div>
        <h1 className="text-4xl font-bold text-white mb-8">Product Analyzer</h1>

        {/* Input Section */}
        <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Analyze Product URL</h2>
          <p className="text-gray-400 text-sm mb-6">
            Enter a product URL from Amazon, Etsy, Shopify or any e-commerce platform
          </p>
          <div className="flex gap-4">
            <input
              type="url"
              placeholder="https://amazon.com/dp/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !url}
              className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg transition"
            >
              {loading ? <Loader className="animate-spin" size={20} /> : <Search size={20} />}
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="grid grid-cols-2 gap-6">
            {/* Product Info */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Product Info</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-gray-400 text-sm">Title</p>
                  <p className="text-white font-semibold">{result.title}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Price</p>
                  <p className="text-white font-semibold">€{result.price}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Rating</p>
                  <p className="text-white font-semibold">
                    {result.rating}★ ({result.reviews} reviews)
                  </p>
                </div>
              </div>
            </div>

            {/* Market Analysis */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Market Analysis</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Demand Score</p>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full"
                      style={{ width: `${result.demandScore}%` }}
                    ></div>
                  </div>
                  <p className="text-emerald-400 text-sm mt-1">{result.demandScore}/100</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-2">Profitability Score</p>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full"
                      style={{ width: `${result.profitabilityScore}%` }}
                    ></div>
                  </div>
                  <p className="text-indigo-400 text-sm mt-1">{result.profitabilityScore}/100</p>
                </div>
              </div>
            </div>

            {/* Radar Score */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Radar Score</h3>
              <div className="text-center">
                <p className="text-5xl font-bold text-indigo-400">{result.radarScore}</p>
                <p className="text-gray-400 text-sm mt-2">/100</p>
              </div>
            </div>

            {/* Recommendation */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <h3 className="text-lg font-bold text-white mb-4">Recommendation</h3>
              <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-lg transition">
                Launch Campaign
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
