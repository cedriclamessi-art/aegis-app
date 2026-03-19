'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Zap, TrendingUp, Users, Sparkles } from 'lucide-react';

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          setIsAuthenticated(true);
          router.push('/dashboard');
        }
      } catch (error) {
        // Not authenticated
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl mb-4 animate-pulse">
            <span className="text-white font-bold text-3xl">A</span>
          </div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="border-b border-slate-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <h1 className="text-xl font-bold text-white">AEGIS SUPREMATIE</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <a className="text-gray-400 hover:text-white transition">Login</a>
          </Link>
          <Link href="/signup">
            <a className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-6 py-2 rounded-lg transition">
              Sign Up
            </a>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-5xl md:text-6xl font-bold text-white mb-6">
            225 Agents IA
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-emerald-500">
              E-Commerce Platform
            </span>
          </h2>
          <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
            Transform a product URL into a profitable campaign in 4 minutes. Powered by AI agents, Radar 360°, and aggressive scaling.
          </p>
          <Link href="/signup">
            <a className="inline-flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-8 py-4 rounded-lg transition text-lg">
              <Sparkles size={24} />
              Start Free Trial
            </a>
          </Link>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <Zap className="text-emerald-500 mb-4" size={32} />
            <h3 className="text-xl font-bold text-white mb-2">Radar 360°</h3>
            <p className="text-gray-400">
              Analyze products, trends, and competition in real-time with 20 AI agents.
            </p>
          </div>

          <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <TrendingUp className="text-indigo-500 mb-4" size={32} />
            <h3 className="text-xl font-bold text-white mb-2">Brand Studio</h3>
            <p className="text-gray-400">
              Generate 9 images, 3 videos, and marketing copy with 42 psychometric models.
            </p>
          </div>

          <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <Users className="text-rose-500 mb-4" size={32} />
            <h3 className="text-xl font-bold text-white mb-2">CEO IA</h3>
            <p className="text-gray-400">
              Automatic scaling decisions with guardrails. Scale aggressively when ROAS > 4.5x.
            </p>
          </div>
        </div>

        {/* Pricing Preview */}
        <div className="text-center mb-16">
          <h3 className="text-3xl font-bold text-white mb-8">Simple, Transparent Pricing</h3>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { name: 'Radar', price: '€99', agents: '20' },
              { name: 'Brand', price: '€199', agents: '40' },
              { name: 'Executive', price: '€999', agents: '75' },
              { name: 'Suprématie', price: '€2999', agents: '225' },
            ].map((plan) => (
              <div key={plan.name} className="bg-slate-900 p-6 rounded-lg border border-slate-800">
                <h4 className="text-lg font-bold text-white mb-2">{plan.name}</h4>
                <p className="text-2xl font-bold text-indigo-400 mb-1">{plan.price}</p>
                <p className="text-sm text-gray-400">{plan.agents} agents</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-indigo-500/10 to-emerald-500/10 border border-indigo-500/20 rounded-xl p-12 text-center">
          <h3 className="text-3xl font-bold text-white mb-4">Ready to scale your e-commerce?</h3>
          <p className="text-gray-400 mb-8">Start with 15 days free. No credit card required.</p>
          <Link href="/signup">
            <a className="inline-flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-8 py-4 rounded-lg transition">
              Get Started Now
            </a>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 mt-20 px-8 py-8 text-center text-gray-400">
        <p>© 2026 AEGIS SUPREMATIE. All rights reserved.</p>
      </div>
    </div>
  );
}
