import React from 'react';
import { AircraftState, ConflictAnalysis } from '../lib/types';
import { ArrowUp, ArrowDown, ArrowRight, ArrowLeft, AlertCircle, Compass, Radio } from 'lucide-react';

interface Props {
  ownship: AircraftState;
  intruder: AircraftState;
  conflict: ConflictAnalysis;
}

export const CockpitDisplay: React.FC<Props> = ({ ownship, intruder, conflict }) => {
  // TCAS VSI Dial geometry
  const maxVSI = 6000;
  const currentVS = Math.max(-maxVSI, Math.min(maxVSI, ownship.verticalSpeed));
  const needleAngleDeg = (currentVS / maxVSI) * 135;

  // Intruder relative bearing and range on CDTI
  const dx = intruder.position.x - ownship.position.x;
  const dy = intruder.position.y - ownship.position.y;
  const intruderRangeNM = Math.sqrt(dx * dx + dy * dy);

  const worldBearingRad = Math.atan2(dx, dy);
  const worldBearingDeg = (worldBearingRad * 180) / Math.PI;

  let relBearingDeg = worldBearingDeg - ownship.heading;
  if (relBearingDeg > 180) relBearingDeg -= 360;
  if (relBearingDeg < -180) relBearingDeg += 360;

  // CDTI Screen Range (15 NM)
  const cdtiRadiusPx = 80;
  const maxCDTINM = 15;
  const displayDistPx = Math.min(cdtiRadiusPx, (intruderRangeNM / maxCDTINM) * cdtiRadiusPx);
  const relBearingRad = (relBearingDeg * Math.PI) / 180;
  const targetX = displayDistPx * Math.sin(relBearingRad);
  const targetY = -displayDistPx * Math.cos(relBearingRad);

  const altDeltaFt = intruder.position.z - ownship.position.z;
  const altDeltaTag = `${altDeltaFt >= 0 ? '+' : '-'}${Math.abs(Math.round(altDeltaFt / 100))
    .toString()
    .padStart(2, '0')}`;
  const intruderVsArrow = intruder.verticalSpeed > 250 ? '↑' : intruder.verticalSpeed < -250 ? '↓' : '';

  const isRA = conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange;
  const isTA = conflict.tcasStatus === 'TRAFFIC_ADVISORY';

  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-4 flex flex-col h-full shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold">
            Avionics Cockpit CDTI &amp; TCAS Display
          </div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
            <span>Ownship: {ownship.callsign}</span>
            <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950 border border-cyan-700 px-1.5 py-0.5 rounded font-bold">
              ADS-B IN ACTIVE
            </span>
          </h3>
        </div>

        {/* Suggestion Badge */}
        <div className="text-right">
          {conflict.recommendedSense !== 'NONE' ? (
            <span
              className={`text-xs font-mono font-black px-2.5 py-1 rounded flex items-center gap-1 shadow-md ${
                isRA
                  ? 'bg-red-500 text-white animate-pulse ring-2 ring-red-400'
                  : 'bg-amber-500 text-slate-950 font-bold'
              }`}
            >
              {conflict.recommendedSense === 'CLIMB' && <ArrowUp className="w-3.5 h-3.5 stroke-[3]" />}
              {conflict.recommendedSense === 'DESCEND' && <ArrowDown className="w-3.5 h-3.5 stroke-[3]" />}
              {conflict.recommendedSense === 'TURN_RIGHT' && <ArrowRight className="w-3.5 h-3.5 stroke-[3]" />}
              {conflict.recommendedSense === 'TURN_LEFT' && <ArrowLeft className="w-3.5 h-3.5 stroke-[3]" />}
              CMD: {conflict.recommendedSense}
            </span>
          ) : (
            <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-700 px-2 py-0.5 rounded">
              MAINTAIN ROUTE
            </span>
          )}
        </div>
      </div>

      {/* Main Dual Gauges (CDTI Radar on left, TCAS VSI Dial on right) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 items-center">
        {/* Left: CDTI Traffic Scope */}
        <div className="flex flex-col items-center justify-center p-3 bg-slate-950 rounded-xl border border-slate-800">
          <div className="text-[10px] font-mono font-bold text-slate-300 mb-1 flex items-center gap-1">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>CDTI Traffic Radar (15 NM Scope)</span>
          </div>

          <div className="relative w-[180px] h-[180px] rounded-full bg-black border-2 border-slate-700 flex items-center justify-center overflow-hidden shadow-inner">
            {/* 12 NM Emergency ring overlay */}
            <div
              className="absolute rounded-full border border-red-500/80 border-dashed"
              style={{
                width: `${(12 / 15) * 180}px`,
                height: `${(12 / 15) * 180}px`,
              }}
            />

            {/* Standard Range rings */}
            <div className="absolute w-[120px] h-[120px] rounded-full border border-dashed border-slate-800" />
            <div className="absolute w-[60px] h-[60px] rounded-full border border-dashed border-slate-800" />

            {/* Compass cross */}
            <div className="absolute w-full h-[1px] bg-slate-800" />
            <div className="absolute h-full w-[1px] bg-slate-800" />

            {/* Range labels */}
            <span className="absolute top-1 text-[8px] font-mono text-slate-400 font-bold">15 NM</span>
            <span className="absolute top-[18px] text-[8px] font-mono text-red-400 font-bold">12 NM EMERG</span>
            <span className="absolute top-[32px] text-[8px] font-mono text-slate-500">10 NM</span>
            <span className="absolute top-[62px] text-[8px] font-mono text-slate-600">5 NM</span>

            {/* Ownship Symbol */}
            <div className="absolute z-10 w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[14px] border-b-cyan-400 drop-shadow" />

            {/* Intruder Aircraft Symbol */}
            <div
              className="absolute transition-all duration-300 z-20 flex flex-col items-center"
              style={{
                transform: `translate(${targetX}px, ${targetY}px)`,
              }}
            >
              {isRA ? (
                <div className="w-4 h-4 bg-red-600 border-2 border-white shadow-lg animate-pulse" />
              ) : isTA ? (
                <div className="w-4 h-4 bg-amber-500 rounded-full border border-white shadow-md" />
              ) : (
                <div className="w-3.5 h-3.5 rotate-45 border-2 border-cyan-400 bg-cyan-950" />
              )}

              {/* Data block tag */}
              <div
                className={`text-[9px] font-mono font-black leading-none mt-1 px-1.5 py-0.5 rounded whitespace-nowrap shadow-md ${
                  isRA
                    ? 'text-white bg-red-600 border border-white'
                    : isTA
                    ? 'text-slate-950 bg-amber-400 font-bold'
                    : 'text-cyan-300 bg-slate-900 border border-cyan-700'
                }`}
              >
                {altDeltaTag} {intruderVsArrow}
              </div>
            </div>
          </div>

          <div className="mt-2 text-[10px] font-mono text-slate-300 font-bold flex items-center justify-between w-full px-2">
            <span>Dist: {intruderRangeNM.toFixed(1)} NM</span>
            <span>Rel. Brg: {Math.round(relBearingDeg)}°</span>
          </div>
        </div>

        {/* Right: TCAS Vertical Speed Indicator (VSI) */}
        <div className="flex flex-col items-center justify-center p-3 bg-slate-950 rounded-xl border border-slate-800">
          <div className="text-[10px] font-mono font-bold text-slate-300 mb-1 flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>TCAS Vertical Speed Indicator</span>
          </div>

          {/* Round VSI Dial */}
          <div className="relative w-[180px] h-[180px] rounded-full bg-black border-2 border-slate-700 flex items-center justify-center shadow-inner">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 180 180">
              {/* Dial tick marks */}
              <g stroke="#475569" strokeWidth="1.5">
                <line x1="90" y1="12" x2="90" y2="26" stroke="#f1f5f9" strokeWidth="2.5" />
                <line x1="132" y1="24" x2="125" y2="35" />
                <line x1="162" y1="55" x2="151" y2="62" />
                <line x1="168" y1="102" x2="155" y2="98" />
                <line x1="144" y1="144" x2="134" y2="134" />

                <line x1="48" y1="24" x2="55" y2="35" />
                <line x1="18" y1="55" x2="29" y2="62" />
                <line x1="12" y1="102" x2="25" y2="98" />
                <line x1="36" y1="144" x2="46" y2="134" />
              </g>

              {/* Dynamic TCAS RA Avoid Arcs and Fly-To Arcs */}
              {isRA && (
                <>
                  {conflict.recommendedSense === 'CLIMB' ? (
                    <>
                      <path
                        d="M 138 38 A 76 76 0 0 1 165 75"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 90 14 A 76 76 0 0 0 15 102"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                    </>
                  ) : (
                    <>
                      <path
                        d="M 42 38 A 76 76 0 0 0 15 75"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 90 14 A 76 76 0 0 1 165 102"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </>
              )}
            </svg>

            {/* Dial Labels */}
            <div className="absolute top-7 text-[10px] font-mono text-white font-bold">0</div>
            <div className="absolute right-6 top-12 text-[9px] font-mono text-slate-300 font-bold">+2</div>
            <div className="absolute right-4 bottom-14 text-[9px] font-mono text-slate-300 font-bold">+6</div>
            <div className="absolute left-6 top-12 text-[9px] font-mono text-slate-300 font-bold">-2</div>
            <div className="absolute left-4 bottom-14 text-[9px] font-mono text-slate-300 font-bold">-6</div>
            <div className="absolute bottom-6 text-[8px] font-mono text-slate-400">1000 FPM</div>

            {/* VSI Center Hub */}
            <div className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-500 z-10 shadow" />

            {/* VSI Needle */}
            <div
              className="absolute w-1.5 h-[70px] bg-cyan-400 origin-bottom rounded-t transition-transform duration-200 shadow-md"
              style={{
                bottom: '90px',
                transform: `rotate(${needleAngleDeg}deg)`,
              }}
            />
          </div>

          <div className="mt-2 text-[10px] font-mono text-slate-200 font-bold flex items-center justify-between w-full px-2">
            <span>Vertical Rate:</span>
            <span
              className={
                ownship.verticalSpeed > 200
                  ? 'text-emerald-400 font-black'
                  : ownship.verticalSpeed < -200
                  ? 'text-rose-400 font-black'
                  : 'text-white'
              }
            >
              {ownship.verticalSpeed > 0 ? '+' : ''}
              {Math.round(ownship.verticalSpeed)} FPM
            </span>
          </div>
        </div>
      </div>

      {/* Cockpit Trajectory Action Alert Banner */}
      <div
        className={`mt-3 p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-2 shadow ${
          isRA
            ? 'bg-red-950/60 border-red-500 text-red-200'
            : isTA
            ? 'bg-amber-950/60 border-amber-500 text-amber-200'
            : 'bg-slate-950 border-slate-800 text-slate-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <AlertCircle
            className={`w-4 h-4 shrink-0 ${
              isRA ? 'text-red-400 animate-bounce' : isTA ? 'text-amber-400' : 'text-slate-400'
            }`}
          />
          <div>
            <span className="font-bold uppercase">
              {isRA ? 'RA EMERGENCY ANNUNCIATION:' : isTA ? 'TA ADVISORY:' : 'STATUS:'}
            </span>{' '}
            <span>{conflict.alertMessage}</span>
          </div>
        </div>

        {conflict.recommendedSense !== 'NONE' && (
          <div className="font-black text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-600 whitespace-nowrap shadow">
            {conflict.recommendedSense === 'CLIMB' && '↑ CLIMB TO RESTORE ALIM'}
            {conflict.recommendedSense === 'DESCEND' && '↓ DESCEND UNDER THREAT'}
            {conflict.recommendedSense === 'TURN_RIGHT' && '→ TURN RIGHT 40°'}
            {conflict.recommendedSense === 'TURN_LEFT' && '← TURN LEFT 35°'}
          </div>
        )}
      </div>
    </div>
  );
};
