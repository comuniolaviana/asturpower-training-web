// Pure sport-only projection. Originals remain private and complete.
const SPORT_FIELDS=new Set(('timestamp startTime totalElapsedTime totalTimerTime totalDistance totalCalories totalFatCalories totalCycles totalStrides avgSpeed maxSpeed enhancedAvgSpeed enhancedMaxSpeed avgHeartRate maxHeartRate minHeartRate avgCadence maxCadence avgFractionalCadence maxFractionalCadence totalFractionalCycles avgPower maxPower minPower normalizedPower totalWork totalAscent totalDescent avgAltitude maxAltitude minAltitude enhancedAvgAltitude enhancedMaxAltitude enhancedMinAltitude avgTemperature maxTemperature minTemperature avgGrade maxPosGrade maxNegGrade avgPosGrade avgNegGrade totalMovingTime avgPosVerticalSpeed avgNegVerticalSpeed maxPosVerticalSpeed maxNegVerticalSpeed trainingStressScore intensityFactor thresholdPower avgLeftTorqueEffectiveness avgRightTorqueEffectiveness avgLeftPedalSmoothness avgRightPedalSmoothness avgCombinedPedalSmoothness avgLeftPco avgRightPco avgLeftPowerPhase avgLeftPowerPhasePeak avgRightPowerPhase avgRightPowerPhasePeak avgPowerPosition maxPowerPosition avgCadencePosition maxCadencePosition totalStandingTime standCount avgVerticalOscillation avgStanceTimePercent avgStanceTime avgFractionalCadence avgVerticalRatio avgStanceTimeBalance avgStepLength avgRespirationRate maxRespirationRate timeInPowerZone timeInHrZone timeInCadenceZone timeInSpeedZone power heartRate cadence fractionalCadence speed enhancedSpeed altitude enhancedAltitude distance temperature grade verticalSpeed calories cycleLength cycles verticalOscillation stanceTime stanceTimePercent verticalRatio stanceTimeBalance stepLength leftRightBalance leftTorqueEffectiveness rightTorqueEffectiveness leftPedalSmoothness rightPedalSmoothness combinedPedalSmoothness leftPco rightPco leftPowerPhase leftPowerPhasePeak rightPowerPhase rightPowerPhasePeak respirationRate accumulatedPower totalHemoglobinConc saturatedHemoglobinPercent strokeType zone event eventType trigger lapTrigger intensity sport subSport numLaps numLengths totalLengths totalStrokes totalTrainingEffect totalAnaerobicTrainingEffect exerciseLoad aerobicTrainingEffect anaerobicTrainingEffect avgStrokeDistance swimStroke poolLength poolLengthUnit avgActiveCadence avgVam maxVam avgLapTime bestLapIndex eventGroup messageIndex eventTimestamp filteredBpm fractionalTimestamp time256').split(' '));
const scalar=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
function sportMessage(record){
 const out={};
 for(const [key,value] of Object.entries(record||{})){
  if(!SPORT_FIELDS.has(key))continue;
  if(value instanceof Date&&Number.isFinite(value.getTime()))out[key]=value.toISOString();
  else if(scalar(value)!==null)out[key]=value;
  else if(Array.isArray(value)&&value.length<100&&value.every(v=>scalar(v)!==null))out[key]=value;
  else if(['sport','subSport','event','eventType','trigger','lapTrigger','intensity'].includes(key)&&typeof value==='string'&&value.length<80)out[key]=value;
 }
 return out;
}
export function buildSportSeries(decoded,{allowSummary=false}={}){
 const source=decoded.messages.recordMesgs||[];
 const hasLaps=(decoded.messages.lapMesgs||[]).some(l=>typeof l.totalTimerTime==='number'&&l.totalTimerTime>0&&Number.isFinite(new Date(l.startTime).getTime()));
 if((!allowSummary&&!source.length&&!hasLaps)||source.length>250000)throw new Error('La actividad requiere revisar el tamaño de sus series. El FIT original se conserva.');
 const records=source.map(sportMessage),fields=[...new Set(records.flatMap(r=>Object.keys(r)))].sort();
 return {version:1,warningCount:decoded.warningCount||0,...(decoded.matchMethod==='tcx_exact_metadata'?{matchMethod:'tcx_exact_metadata'}:{}),fields,rows:records.map(r=>fields.map(k=>r[k]??null)),
  sessions:(decoded.messages.sessionMesgs||[]).map(sportMessage),laps:(decoded.messages.lapMesgs||[]).map(sportMessage),
  events:(decoded.messages.eventMesgs||[]).map(sportMessage)};
}
