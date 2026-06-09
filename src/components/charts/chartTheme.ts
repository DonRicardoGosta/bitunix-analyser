// Shared dark styling fragments for ECharts options.

export const darkChart = {
  textStyle: { color: '#94a3b8', fontFamily: 'Inter, sans-serif' },
  gridColor: '#1f2937',
  axisLine: { lineStyle: { color: '#334155' } },
  splitLine: { lineStyle: { color: 'rgba(51,65,85,0.35)' } },
  tooltipBg: 'rgba(15,21,33,0.95)',
  tooltipBorder: '#334155',
  up: '#22c55e',
  down: '#ef4444',
  accent: '#22d3ee',
  amber: '#f59e0b',
  violet: '#a78bfa',
}

export function baseTooltip() {
  return {
    backgroundColor: darkChart.tooltipBg,
    borderColor: darkChart.tooltipBorder,
    textStyle: { color: '#e5e7eb', fontSize: 12 },
  }
}
