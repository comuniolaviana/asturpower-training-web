# AsturPower · Criterios de análisis deportivo contrastados con TrainingPeaks

**Fecha de revisión:** 2026-11-14  
**Alcance:** métodos publicados y comprobables para la vista del entrenador. No supone compatibilidad idéntica con TrainingPeaks ni acceso a código propietario.

## Fuente de verdad y procedencia

1. Mantener intactas las medidas originales del FIT/Garmin y sus fuentes. No sustituir silenciosamente métricas Garmin por cálculos internos.
2. Diferenciar `registrado por Garmin`, `calculado a partir de muestras`, `calculado con FTP histórico confirmado`, `estimado por entrenador` y `no disponible`.
3. Guardar parámetros vigentes **en la fecha de la sesión**; nunca extrapolar automáticamente el FTP actual al pasado.
4. Identificar sensor/dispositivo cuando estén disponibles, e indoor/outdoor; no mezclar automáticamente récords de rodillo y carretera sin mostrar su procedencia.
5. La ausencia de TSS no significa TSS cero ni descanso. Sin historial suficientemente completo no declarar CTL, ATL y TSB clínicamente fiables.

## Métricas básicas de ciclismo

| Concepto | Referencia metodológica | Validación necesaria |
|---|---|---|
| Potencia media | Promedio del esfuerzo realmente medido (respetar muestreo, pausas y duración del fichero) | Comparar contra el FIT real; jamás inferir potencia donde falte |
| NP | Medias móviles de potencia de 30 s; elevar a 4; promediar; raíz cuarta | Serie temporal y pausas/muestras; no presentar NP de intervalos demasiado cortos como referencia fisiológica fiable |
| IF | `NP / FTP` | Exigir FTP positivo, vigente y específico para el día |
| TSS por potencia | `duración_horas × IF² × 100` (equivale a 100 para 1 h con IF=1) | Duración activa coherente con el cálculo NP; origen del FTP y calidad de muestras |
| Trabajo (kJ) | `trabajo_mecánico_julios / 1000`; si no hay campo válido, solo integrar potencia realmente muestreada cuando el procedimiento esté probado | No confundir kilojulios de trabajo mecánico con calorías metabólicas |
| VI | `NP / potencia_media` | Solo si ambos datos son válidos; no dividir entre cero |
| FC/rpm | Media, máximo, tiempo en zonas y curvas con muestras de su fuente | Indicar intervalos no medidos y mostrar el sensor cuando conste |

La metodología pública describe NP con ventana de 30 segundos y advierte de su interpretación limitada en intervalos cortos. El IF y el TSS dependen del umbral válido. El FT/FTP procede del entrenador/deportista y no del software de forma automática.

## Otras modalidades y métodos de carga

- Ciclismo con potencia y FTP válidos: TSS por potencia preferente.
- Carrera con ritmo/pendiente/umbral suficientes: evaluar rTSS según las referencias publicadas antes de implementarlo.
- Actividades con FC y umbral: evaluar hrTSS; para esfuerzos intermitentes tiene limitaciones. tTSS/TRIMP no son idénticos y requieren reglas documentadas.
- Fuerza/gimnasio sin datos fisiológicos suficientes: **carga desconocida o estimación del entrenador claramente etiquetada**, no TSS de potencia inventado.
- Conservar el método efectivo elegido para cada actividad, sin sumar TSS y hrTSS sobre la misma sesión.

## PMC: carga, fatiga y forma

Si la carga diaria válida es `L_d`:
- `CTL_d = CTL_(d-1) + (L_d - CTL_(d-1))/42`
- `ATL_d = ATL_(d-1) + (L_d - ATL_(d-1))/7`
- `TSB_d = CTL_(d-1) - ATL_(d-1)`

Las cargas válidas de distintas actividades de una jornada se agregan una sola vez. Conservar zona horaria del deportista y definir inicio del modelo. Distinguir actividad planificada, actividad realizada y previsiones; al ejecutar una planificada, no contar dos veces.

**Regla de integridad:** Si faltan TSS o hay importaciones parciales, el panel debe etiquetar el modelo como incompleto, identificar las actividades pendientes y evitar cifras de fatiga presentadas como exactas. CTL/ATL/TSB ayudan a seguir la carga: no son un diagnóstico de sobreentrenamiento ni una garantía de rendimiento.

## Prioridad de implementación acordada

1. **Calidad del dato:** recepción de FIT completo y cadencia, FC, potencia, trabajo y sesiones Garmin; identificar qué actividades de ciclismo siguen sin análisis ni series y cuál es la causa.
2. **Métricas por sesión:** panel mínimo NP, IF, TSS, FTP fechado, kJ, pulso, rpm, medias, máximos, procedencia de cada cifra; comparar el resultado con el original Garmin y con exportaciones del titular desde TrainingPeaks.
3. **Fiabilidad de carga:** revisar las entradas del PMC, historial FTP, métodos por deporte, días incompletos, sesiones duplicadas y sustitución de previstas por reales.
4. **Gráficos deportivos:** métricas superpuestas por minuto/muestra, laps e intervalos; filtros por fecha y entorno indoor/outdoor; máximos de potencia separados por dispositivo/origen.
5. **Proyecciones y mejoras:** carga prevista, cambios en el plan y comparativa programado/realizado, siempre marcada como proyección.

## Pruebas numéricas mínimas

- 3.600 muestras a 200 W durante una hora, con FTP=250 W → NP=200 W, IF=0,8, TSS=64, trabajo=720 kJ si la potencia realmente cubre toda esa hora.
- Una hora a IF 0,85 → 72,25 TSS.
- Carga constante 100 TSS/día → CTL y ATL convergen a 100; el TSB de hoy se obtiene de ayer.
- Una actividad de bici sin potencia ni TSS y una sesión de fuerza sin método validado **no** se interpretan como descanso.
- Cambiar FTP desde una fecha posterior no altera automáticamente las sesiones anteriores.
- Verificación visual en escritorio/móvil y modo oscuro antes del despliegue.

## Fuentes oficiales consultadas

- TrainingPeaks, [Normalized Power](https://help.trainingpeaks.com/hc/en-us/articles/204071804-Normalized-Power) y [explicación del cálculo NP](https://www.trainingpeaks.com/coach-blog/normalized-power-how-coaches-use/).
- TrainingPeaks, [Intensity Factor](https://help.trainingpeaks.com/hc/en-us/articles/204071814-Intensity-Factor-IF).
- TrainingPeaks, [Training Stress Scores Explained](https://help.trainingpeaks.com/hc/en-us/articles/204071944-Training-Stress-Scores-TSS-Explained).
- TrainingPeaks, [Fitness / CTL](https://help.trainingpeaks.com/hc/en-us/articles/204071884-Fitness-CTL).
- TrainingPeaks, [Fatigue / ATL](https://help.trainingpeaks.com/hc/en-us/articles/204071894-Fatigue-ATL).
- TrainingPeaks, [Form / TSB](https://help.trainingpeaks.com/hc/en-us/articles/204071764-Form-TSB).
- TrainingPeaks, [Advanced Analysis Metrics](https://help.trainingpeaks.com/hc/en-us/articles/204072154-Advanced-Analysis-Metrics).

Este documento fija criterios de implementación para AsturPower; **no** implica copiar ni redistribuir código, documentación o elementos protegidos de TrainingPeaks.
