import React, { useState } from 'react';
import { AircraftState, ConflictAnalysis } from '../lib/types';
import { generateADSBTelemetry, EMERGENCY_PROMPT_RANGE_NM } from '../lib/algorithms';
import { Activity, ShieldCheck, Binary, Cpu, BarChart2, Radio, Terminal, AlertTriangle } from 'lucide-react';

interface Props {
  planeA: AircraftState;
  planeB: AircraftState;
  conflict: ConflictAnalysis;
  timeHistory: Array<{
    timeSec: number;
    distanceNM: number;
    altA: number;
    altB: number;
  }>;
}

export const TelemetryPanel: React.FC<Props> = ({
  planeA,
  planeB,
  conflict,
  timeHistory,
}) => {
  const [activeTab, setActiveTab] = useState<'TELEMETRY' | 'MATH' | 'GRAPHS' | 'PACKETS'>('TELEMETRY');

  const adsbA = generateADSBTelemetry(planeA);
  const adsbB = generateADSBTelemetry(planeB);

  return (
    <div className="bg-black border border-blue-900/60 rounded-xl p-4 flex flex-col h-full text-white shadow-2xl">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-blue-900/40 pb-3 mb-3">
        <div className="flex items-center gap-1.5 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
          <button
            onClick={() => setActiveTab('TELEMETRY')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'TELEMETRY'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>ADS-B Data</span>
          </button>

          <button
            onClick={() => setActiveTab('MATH')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'MATH'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>TCAS / FLARM Math</span>
          </button>

          <button
            onClick={() => setActiveTab('GRAPHS')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'GRAPHS'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Separation Graphs</span>
          </button>

          <button
            onClick={() => setActiveTab('PACKETS')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'PACKETS'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Mode S Stream</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400 font-bold">Detection Range:</span>
          <span className="text-blue-300 font-black bg-blue-950 border border-blue-600 px-2 py-0.5 rounded shadow">
            12.0 NM EMERGENCY PROMPT
          </span>
        </div>
      </div>

      {/* Tab 1: Full ADS-B Mock Data */}
      {activeTab === 'TELEMETRY' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Plane A Card */}
            <div className="p-3.5 bg-neutral-950 rounded-xl border border-blue-500/50 flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
                  <span className="font-mono font-bold text-sm text-blue-400">{adsbA.callsign}</span>
                  <span className="text-[10px] font-mono text-slate-400">HEX: 0x{adsbA.icaoHex}</span>
                </div>
                <span className="text-[10px] font-mono font-bold bg-blue-950 border border-blue-700 px-2 py-0.5 rounded text-blue-300">
                  SQK: {adsbA.squawk}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">BARO ALTITUDE:</span>
                  <div className="font-black text-white">{adsbA.baroAltitudeFt.toLocaleString()} FT</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">GNSS ALTITUDE:</span>
                  <div className="font-black text-white">{adsbA.gnssAltitudeFt.toLocaleString()} FT</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">GROUND SPEED:</span>
                  <div className="font-black text-white">{adsbA.groundSpeedKt} KT (TAS: {adsbA.trueAirspeedKt})</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">TRACK / HEADING:</span>
                  <div className="font-black text-white">{adsbA.headingDeg}°</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">VERTICAL RATE:</span>
                  <div className={`font-black ${adsbA.verticalRateFpm !== 0 ? 'text-blue-400' : 'text-white'}`}>
                    {adsbA.verticalRateFpm > 0 ? '+' : ''}{adsbA.verticalRateFpm} FPM
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">TURN RATE:</span>
                  <div className="font-black text-white">{adsbA.turnRateDegSec}°/s</div>
                </div>
                <div className="col-span-2 border-t border-neutral-800 pt-2 flex justify-between text-[11px]">
                  <span className="text-slate-400 font-bold">LAT / LON:</span>
                  <span className="text-slate-200 font-semibold">{adsbA.lat.toFixed(4)}°N, {Math.abs(adsbA.lon).toFixed(4)}°W</span>
                </div>
                <div className="col-span-2 flex justify-between text-[10px] text-slate-400 pt-0.5 font-semibold">
                  <span>NIC: {adsbA.nic} (Containment &lt; 75m)</span>
                  <span>NACp: {adsbA.nacp} · SIL: {adsbA.sil}</span>
                </div>
              </div>
            </div>

            {/* Plane B Card */}
            <div className="p-3.5 bg-neutral-950 rounded-xl border border-white/40 flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-white shadow-sm shadow-white/50" />
                  <span className="font-mono font-bold text-sm text-white">{adsbB.callsign}</span>
                  <span className="text-[10px] font-mono text-slate-400">HEX: 0x{adsbB.icaoHex}</span>
                </div>
                <span className="text-[10px] font-mono font-bold bg-neutral-900 border border-neutral-700 px-2 py-0.5 rounded text-white">
                  SQK: {adsbB.squawk}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">BARO ALTITUDE:</span>
                  <div className="font-black text-white">{adsbB.baroAltitudeFt.toLocaleString()} FT</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">GNSS ALTITUDE:</span>
                  <div className="font-black text-white">{adsbB.gnssAltitudeFt.toLocaleString()} FT</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">GROUND SPEED:</span>
                  <div className="font-black text-white">{adsbB.groundSpeedKt} KT (TAS: {adsbB.trueAirspeedKt})</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">TRACK / HEADING:</span>
                  <div className="font-black text-white">{adsbB.headingDeg}°</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">VERTICAL RATE:</span>
                  <div className={`font-black ${adsbB.verticalRateFpm !== 0 ? 'text-white' : 'text-slate-300'}`}>
                    {adsbB.verticalRateFpm > 0 ? '+' : ''}{adsbB.verticalRateFpm} FPM
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold">TURN RATE:</span>
                  <div className="font-black text-white">{adsbB.turnRateDegSec}°/s</div>
                </div>
                <div className="col-span-2 border-t border-neutral-800 pt-2 flex justify-between text-[11px]">
                  <span className="text-slate-400 font-bold">LAT / LON:</span>
                  <span className="text-slate-200 font-semibold">{adsbB.lat.toFixed(4)}°N, {Math.abs(adsbB.lon).toFixed(4)}°W</span>
                </div>
                <div className="col-span-2 flex justify-between text-[10px] text-slate-400 pt-0.5 font-semibold">
                  <span>NIC: {adsbB.nic} (Containment &lt; 75m)</span>
                  <span>NACp: {adsbB.nacp} · SIL: {adsbB.sil}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Status Bar */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="text-slate-400 text-[10px] font-bold">RANGE:</span>{' '}
                <span className="font-black text-white">{conflict.distanceNM.toFixed(2)} NM</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] font-bold">VERT DELTA:</span>{' '}
                <span className="font-black text-white">{Math.round(conflict.verticalDeltaFt)} FT</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] font-bold">CLOSURE RATE:</span>{' '}
                <span className="font-black text-rose-400">{Math.round(conflict.rangeRateKnots)} KT</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[10px] font-bold">STATUS:</span>
              <span
                className={`font-black px-2.5 py-0.5 rounded text-[11px] ${
                  conflict.tcasStatus === 'RESOLUTION_ADVISORY'
                    ? 'bg-red-500 text-white shadow-md'
                    : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                }`}
              >
                {conflict.tcasStatus}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Live Calculations & Formulas */}
      {activeTab === 'MATH' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 text-xs font-mono">
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-cyan-300 font-bold border-b border-slate-800 pb-1.5">
              <span>TCAS II Modified Tau (&tau;_mod) with 12 NM Emergency Envelope</span>
              <span>{conflict.horizontalTauSec}s (Threshold: 30s)</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Evaluates slant range, closure rate, and distance modification (DMOD = 1.1 NM). Inside 12 NM, triggers immediate emergency resolution:
            </p>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-200">
              <div className="text-cyan-300 font-bold">
                &tau;_mod = - (r&sup2; - DMOD&sup2;) / (r &middot; r&#775;)
              </div>
              <div className="text-slate-400 text-[11px] mt-1">
                = - (({conflict.distanceNM.toFixed(2)})&sup2; - 1.1&sup2;) / ({conflict.distanceNM.toFixed(2)} &middot; ({(conflict.rangeRateKnots / 3600).toFixed(4)} NM/s))
              </div>
              <div className="text-emerald-400 font-bold mt-1">
                = {conflict.horizontalTauSec} seconds to Tau boundary (Emergency Zone: &le; 12.0 NM)
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-amber-400 font-bold border-b border-slate-800 pb-1.5">
              <span>3D Closest Point of Approach (CPA) Formulation</span>
              <span>t_CPA: {conflict.timeToCPASec}s · d_CPA: {conflict.distanceAtCPANM} NM</span>
            </div>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-200">
              <div className="text-amber-300 font-bold">
                t_cpa = - (r&#8407; &middot; v&#8407;) / |v&#8407;|&sup2;
              </div>
              <div className="text-slate-400 text-[11px] mt-1">
                d_cpa = |r&#8407;(t_cpa)| = {conflict.distanceAtCPANM} NM · &Delta;Alt_cpa = {conflict.verticalSepAtCPAFt} FT
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-rose-400 font-bold border-b border-slate-800 pb-1.5">
              <span>FLARM Non-Linear Trajectory Risk Score</span>
              <span>Level {conflict.flarmLevel} ({conflict.flarmRiskPercent}%)</span>
            </div>
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  conflict.flarmRiskPercent > 60
                    ? 'bg-rose-500'
                    : conflict.flarmRiskPercent > 30
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${conflict.flarmRiskPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Separation Graphs */}
      {activeTab === 'GRAPHS' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-cyan-400 font-bold">Slant Range (NM vs Time)</span>
              <span className="text-red-400 font-bold">12 NM Emergency Threshold Marked</span>
            </div>

            <div className="h-32 w-full bg-black border border-slate-800 rounded-lg p-2 relative flex items-end">
              <svg className="w-full h-full" viewBox="0 0 300 90" preserveAspectRatio="none">
                {/* 12 NM Line */}
                <line x1="0" y1="45" x2="300" y2="45" stroke="#ef4444" strokeDasharray="4,4" strokeWidth="1.5" />
                <text x="5" y="42" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">
                  12.0 NM EMERGENCY PROMPT BOUNDARY
                </text>

                {/* Min Separation line at 1.5 NM */}
                <line x1="0" y1="78" x2="300" y2="78" stroke="#f43f5e" strokeWidth="1" />

                {timeHistory.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="2.5"
                    points={timeHistory
                      .map((pt, i) => {
                        const x = (i / Math.max(1, timeHistory.length - 1)) * 300;
                        const y = Math.max(5, Math.min(85, 85 - (pt.distanceNM / 24) * 80));
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                )}
              </svg>
            </div>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-amber-400 font-bold">Altitude Profile (Flight A vs Flight B)</span>
              <span className="text-slate-300 font-semibold">Sep: {Math.round(conflict.verticalDeltaFt)} FT</span>
            </div>

            <div className="h-32 w-full bg-black border border-slate-800 rounded-lg p-2 relative flex items-end">
              <svg className="w-full h-full" viewBox="0 0 300 90" preserveAspectRatio="none">
                {timeHistory.length > 1 && (
                  <>
                    <polyline
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="2.5"
                      points={timeHistory
                        .map((pt, i) => {
                          const x = (i / Math.max(1, timeHistory.length - 1)) * 300;
                          const y = Math.max(5, Math.min(85, 85 - ((pt.altA - 15000) / 25000) * 80));
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="2.5"
                      points={timeHistory
                        .map((pt, i) => {
                          const x = (i / Math.max(1, timeHistory.length - 1)) * 300;
                          const y = Math.max(5, Math.min(85, 85 - ((pt.altB - 15000) / 25000) * 80));
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  </>
                )}
              </svg>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-3 h-1 bg-cyan-400 inline-block rounded" />
                <span>{planeA.callsign} Alt</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-1 bg-amber-400 inline-block rounded" />
                <span>{planeB.callsign} Alt</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Raw Mode S Extended Squitter Packets */}
      {activeTab === 'PACKETS' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 text-xs font-mono">
          <div className="text-[11px] text-slate-300 mb-1 font-semibold">
            Simulated 1090MHz ADS-B Out Extended Squitter (DF17) Transponder Packet Stream:
          </div>

          <div className="p-3 bg-slate-950 rounded-xl border border-cyan-700 flex flex-col gap-1.5 shadow">
            <div className="flex items-center justify-between text-cyan-300 font-bold">
              <span>RX: {planeA.callsign} (ICAO: 0x{planeA.icaoHex})</span>
              <span className="text-[10px] text-slate-400">{adsbA.timestamp}</span>
            </div>
            <div className="text-white select-all bg-black p-2.5 rounded-lg border border-slate-800 break-all font-mono font-bold">
              {adsbA.rawHexFrame}
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              DF=17 · TC=19 (Velocity) · BaroAlt={adsbA.baroAltitudeFt} FT · GS={adsbA.groundSpeedKt} KT · Hdg={adsbA.headingDeg}°
            </div>
          </div>

          <div className="p-3 bg-slate-950 rounded-xl border border-amber-700 flex flex-col gap-1.5 shadow">
            <div className="flex items-center justify-between text-amber-300 font-bold">
              <span>RX: {planeB.callsign} (ICAO: 0x{planeB.icaoHex})</span>
              <span className="text-[10px] text-slate-400">{adsbB.timestamp}</span>
            </div>
            <div className="text-white select-all bg-black p-2.5 rounded-lg border border-slate-800 break-all font-mono font-bold">
              {adsbB.rawHexFrame}
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              DF=17 · TC=11 (Position) · Lat={adsbA.lat.toFixed(4)} · Lon={adsbA.lon.toFixed(4)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
