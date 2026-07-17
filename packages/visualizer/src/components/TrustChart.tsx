import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { TrustTrend } from "../hooks/useAnalytics.js";

interface TrustChartProps {
  data: TrustTrend[];
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrustTrend }>;
}): React.ReactElement | null {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-value">{d.trustPct}%</div>
      <div className="chart-tooltip-detail">
        {d.claimsTrue} verified · {d.claimsFalse} false
      </div>
    </div>
  );
}

export function TrustChart({ data }: TrustChartProps): React.ReactElement {
  if (data.length === 0) {
    return (
      <div className="chart-section">
        <div className="chart-header">Trust over time</div>
        <div className="chart-empty">
          <div className="chart-empty-line" />
          <div className="chart-empty-text">
            Trends build as you run more sessions
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-section">
      <div className="chart-header">Trust over time</div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="session"
              tick={{ fill: "var(--text-2)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--text-2)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "var(--text-2)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="trustPct"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ fill: "var(--accent)", r: 3, strokeWidth: 0 }}
              activeDot={{ fill: "var(--accent)", r: 5, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
