// Shared dark styling fragments for ECharts options.

import type { MarkLineComponentOption } from 'echarts'

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

/** Badge-style label matching SetupChart HTML overlay (for ECharts markLine). */
export function referenceLineLabel(color: string, text: string) {
  return {
    show: true,
    formatter: text,
    position: 'insideEndTop' as const,
    color,
    backgroundColor: '#0b0f18',
    borderColor: color,
    borderWidth: 1,
    padding: [1, 6],
    fontSize: 11,
    fontWeight: 600 as const,
    fontFamily: 'Inter, sans-serif',
  }
}

export interface ReferenceLineSpec {
  yAxis: number
  label: string
  color: string
  dashed?: boolean
}

/** Single markLine data entry with SetupChart-style badge label. */
export function markLineWithLabel(
  yAxis: number,
  label: string,
  color: string,
  dashed = true,
): NonNullable<MarkLineComponentOption['data']>[number] {
  return {
    yAxis,
    lineStyle: { color, type: dashed ? 'dashed' : 'solid', width: 1 },
    label: referenceLineLabel(color, label),
  }
}

/** Full markLine config for one or more reference levels. */
export function referenceMarkLine(lines: ReferenceLineSpec[]): MarkLineComponentOption {
  return {
    symbol: 'none',
    silent: true,
    data: lines.map((l) => markLineWithLabel(l.yAxis, l.label, l.color, l.dashed ?? true)),
  }
}
