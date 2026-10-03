"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ComparisonCharts({
  fixedVariable,
  sensitivity,
  hyperscalerLabel = "Hyperscaler",
}: {
  fixedVariable: Array<{ name: string; OpenShift: number; Hyperscaler: number }>;
  sensitivity: Array<{ requestsPerDay: number; openshift: number; hyperscaler: number }>;
  hyperscalerLabel?: string;
}) {
  return (
    <>
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h2>Fixed vs variable</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={fixedVariable}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
            <XAxis dataKey="name" stroke="#8b9cb3" />
            <YAxis stroke="#8b9cb3" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatUsd(Number(v))} />
            <Legend />
            <Bar dataKey="OpenShift" fill="#ee0000" />
            <Bar dataKey="Hyperscaler" name={hyperscalerLabel} fill="#0066cc" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {sensitivity.length > 0 && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h2>Sensitivity: requests per day</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sensitivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3a4f" />
              <XAxis dataKey="requestsPerDay" stroke="#8b9cb3" />
              <YAxis stroke="#8b9cb3" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatUsd(Number(v))} />
              <Legend />
              <Bar dataKey="openshift" name="OpenShift" fill="#ee0000" />
              <Bar dataKey="hyperscaler" name={hyperscalerLabel} fill="#0066cc" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
