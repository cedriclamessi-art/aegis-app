'use client';

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { Check, Zap } from 'lucide-react';

const plans = [
  {
    tier: 1,
    name: 'Radar',
    price: 99,
    agents: 20,
    dailyMax: '€100',
    features: ['Radar 360°', '20 agents', 'Market intelligence', 'Trend detection'],
  },
  {
    tier: 2,
    name: 'Brand',
    price: 199,
    agents: 40,
    dailyMax: '€500',
    features: ['All Radar features', 'Brand Studio', '40 agents', '27 images generation'],
  },
  {
    tier: 3,
    name: 'Executive',
    price: 999,
    agents: 75,
    dailyMax: '€2,000',
    features: ['All Brand features', 'Aggressive scaling', '75 agents', 'CEO IA decisions'],
    popular: true,
  },
  {
    tier: 4,
    name: 'Suprématie',
    price: 2999,
    agents: 225,
    dailyMax: '€10,000',
    features: ['All Executive features', '225 agents', 'Commission-based', 'Unlimited scaling'],
  },
];

export default function BillingPage() {
  const [user, setUser] = useState<any>(null);

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
        <h1 className="text-4xl font-bold text-white mb-8">Billing & Pricing</h1>

        {/* Current Plan */}
        {user && (
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Current Plan</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">
                  {user.tier === 1 && 'Radar'}
                  {user.tier === 2 && 'Brand'}
                  {user.tier === 3 && 'Executive'}
                  {user.tier === 4 && 'Suprématie'}
                </p>
                <p className="text-2xl font-bold text-white">
                  {user.isFounder ? 'Founder - Lifetime Free' : `€${plans[user.tier - 1]?.price || 0}/month`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm">Status</p>
                <p className="text-white font-semibold capitalize">{user.subscriptionStatus}</p>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Plans */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Choose Your Plan</h2>
          <div className="grid grid-cols-4 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.tier}
                className={`rounded-xl p-6 border transition ${
                  plan.popular
                    ? 'bg-indigo-500/10 border-indigo-500 ring-2 ring-indigo-500'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                {plan.popular && (
                  <div className="mb-4 inline-block bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    POPULAR
                  </div>
                )}
                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <p className="text-3xl font-bold text-white">€{plan.price}</p>
                  <p className="text-gray-400 text-sm">/month</p>
                </div>

                <div className="mb-4 space-y-2 text-sm">
                  <p className="text-gray-300">
                    <span className="font-semibold text-emerald-400">{plan.agents}</span> agents
                  </p>
                  <p className="text-gray-300">
                    Daily limit: <span className="font-semibold text-indigo-400">{plan.dailyMax}</span>
                  </p>
                </div>

                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-gray-300 text-sm">
                      <Check size={16} className="text-emerald-500" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full py-2 rounded-lg font-bold transition ${
                    plan.popular
                      ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-gray-300'
                  }`}
                >
                  {user?.tier === plan.tier ? 'Current Plan' : 'Upgrade'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Trial Info */}
        <div className="bg-emerald-500/10 border border-emerald-500 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="text-emerald-500" size={24} />
            <h3 className="text-lg font-bold text-white">Free Trial Available</h3>
          </div>
          <p className="text-gray-300">
            Start with 15 days free access to the Radar plan. No credit card required.
          </p>
        </div>

        {/* Founders */}
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <h3 className="text-lg font-bold text-white mb-4">Founder Pricing</h3>
          <p className="text-gray-300 mb-4">Lifetime free access to all features for early supporters:</p>
          <ul className="space-y-2">
            <li className="text-indigo-400 font-semibold">jonathanlamessi@yahoo.fr</li>
            <li className="text-indigo-400 font-semibold">enna.lamessi@gmail.com</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
