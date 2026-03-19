'use client';

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Zap, TrendingUp, Users, DollarSign, Plus } from 'lucide-react';
import Link from 'next/link';

const data = [
  { month: 'Jan', revenue: 4000, campaigns: 2 },
  { month: 'Feb', revenue: 3000, campaigns: 1 },
  { month: 'Mar', revenue: 2000, campaigns: 3 },
  { month: 'Apr', revenue: 2780, campaigns: 2 },
  { month: 'May', revenue: 1890, campaigns: 4 },
  { month: 'Jun', revenue: 2390, campaigns: 2 },
];

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({
    activeCampaigns: 0,
    totalRevenue: 0,
    avgROAS: 0,
    agentsActive: 0,
  });

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

  return (
    <Layout user={user}>
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
            <p className="text-gray-400">Welcome back, {user?.name || 'User'}</p>
          </div>
          <Link href="/analyzer">
            <a className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-6 py-3 rounded-lg transition">
              <Plus size={20} />
              New Campaign
            </a>
          </Link>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-6 mb-8">
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm mb-1">Active Campaigns</p>
                <p className="text-3xl font-bold text-white">{stats.activeCampaigns}</p>
              </div>
              <Zap className="text-emerald-500" size={32} />
            </div>
          </div>

          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm mb-1">Total Revenue</p>
                <p className="text-3xl font-bold text-white">€{stats.totalRevenue.toLocaleString()}</p>
              </div>
              <DollarSign className="text-indigo-500" size={32} />
            </div>
          </div>

          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm mb-1">Avg ROAS</p>
                <p className="text-3xl font-bold text-white">{stats.avgROAS.toFixed(1)}x</p>
              </div>
              <TrendingUp className="text-rose-500" size={32} />
            </div>
          </div>

          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm mb-1">Agents Active</p>
                <p className="text-3xl font-bold text-white">{stats.agentsActive}</p>
              </div>
              <Users className="text-emerald-500" size={32} />
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 mb-8">
          <h2 className="text-xl font-bold text-white mb-6">Revenue & Campaigns Trend</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Legend />
              <Bar dataKey="revenue" fill="#6366f1" />
              <Bar dataKey="campaigns" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Campaigns */}
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <h2 className="text-xl font-bold text-white mb-6">Recent Campaigns</h2>
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">No campaigns yet</p>
            <Link href="/analyzer">
              <a className="inline-flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-6 py-3 rounded-lg transition">
                <Plus size={20} />
                Create Your First Campaign
              </a>
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
