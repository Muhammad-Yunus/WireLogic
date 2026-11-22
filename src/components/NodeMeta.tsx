import React from 'react';
import {
  AlertCircle,
  Bot,
  CloudUpload,
  Code2,
  Database,
  GitBranch,
  Pencil,
  PlusCircle,
  Shuffle,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import type { NodeFunctionSubtype, NodeKind, WorkflowNode } from '../shared/types';

export interface FunctionCatalogItem {
  category: 'CRUD' | 'SQL' | 'Data' | 'Outputs & Alerts';
  subtype: NodeFunctionSubtype;
  kind: NodeKind;
  label: string;
  defaultTitle: string;
  description?: string;
}

export const FUNCTION_CATALOG: FunctionCatalogItem[] = [
  {
    category: 'CRUD',
    subtype: 'replicate',
    kind: 'sql',
    label: 'Replicate',
    defaultTitle: 'Replicate Records',
  },
  {
    category: 'CRUD',
    subtype: 'delete',
    kind: 'sql',
    label: 'Delete',
    defaultTitle: 'Delete Record',
  },
  {
    category: 'CRUD',
    subtype: 'insert',
    kind: 'sql',
    label: 'Insert',
    defaultTitle: 'Insert Record',
  },
  {
    category: 'CRUD',
    subtype: 'select',
    kind: 'sql',
    label: 'Select',
    defaultTitle: 'Select Query',
  },
  {
    category: 'CRUD',
    subtype: 'update',
    kind: 'sql',
    label: 'Update',
    defaultTitle: 'Update Record',
  },
  {
    category: 'SQL',
    subtype: 'delete_stmt',
    kind: 'sql',
    label: 'Delete Statement',
    defaultTitle: 'Delete Statement',
  },
  {
    category: 'SQL',
    subtype: 'insert_stmt',
    kind: 'sql',
    label: 'Insert Statement',
    defaultTitle: 'Insert Statement',
  },
  {
    category: 'SQL',
    subtype: 'upsert_stmt',
    kind: 'sql',
    label: 'Upsert Statement',
    defaultTitle: 'Upsert Statement',
  },
  {
    category: 'SQL',
    subtype: 'sql_query',
    kind: 'sql',
    label: 'SQL Query',
    defaultTitle: 'SQL Query',
  },
  {
    category: 'Data',
    subtype: 'rest',
    kind: 'rest',
    label: 'REST',
    defaultTitle: 'REST',
    description: 'Makes a REST API request to an external endpoint.',
  },
  {
    category: 'Data',
    subtype: 'chatgpt',
    kind: 'ai',
    label: 'ChatGPT / AI',
    defaultTitle: 'AI / LLM',
    description: 'Generates structured insights using Gemini or custom LLM.',
  },
  {
    category: 'Data',
    subtype: 'javascript',
    kind: 'javascript',
    label: 'JavaScript',
    defaultTitle: 'JavaScript',
  },
  {
    category: 'Data',
    subtype: 'condition',
    kind: 'condition',
    label: 'Condition',
    defaultTitle: 'Condition',
    description: 'Routes execution to branch 1 or 2 based on expression.',
  },
  {
    category: 'Outputs & Alerts',
    subtype: 'alert',
    kind: 'alert',
    label: 'Alert',
    defaultTitle: 'Alert',
    description: 'Sends an alert if severe conditions are detected.',
  },
  {
    category: 'Outputs & Alerts',
    subtype: 'export_pdf',
    kind: 'pdf',
    label: 'Export to PDF',
    defaultTitle: 'Export to PDF',
  },
  {
    category: 'Outputs & Alerts',
    subtype: 'upload_s3',
    kind: 's3',
    label: 'Upload to S3',
    defaultTitle: 'Upload to S3',
  },
];

export function NodeBadgeIcon({
  kind,
  subtype,
  size = 'md',
}: {
  kind: NodeKind;
  subtype?: NodeFunctionSubtype;
  size?: 'sm' | 'md';
}) {
  const boxCls = size === 'sm' ? 'w-5 h-5 rounded-[5px]' : 'w-[22px] h-[22px] rounded-[5px]';
  const iconCls = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  if (subtype === 'replicate') {
    return (
      <span className={`${boxCls} bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center shrink-0`}>
        <Zap className={iconCls} />
      </span>
    );
  }
  if (subtype === 'delete' || subtype === 'delete_stmt') {
    return (
      <span className={`${boxCls} bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0`}>
        <Trash2 className={iconCls} />
      </span>
    );
  }
  if (subtype === 'insert' || subtype === 'insert_stmt') {
    return (
      <span className={`${boxCls} bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center shrink-0`}>
        <PlusCircle className={iconCls} />
      </span>
    );
  }
  if (subtype === 'update') {
    return (
      <span className={`${boxCls} bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0`}>
        <Pencil className={iconCls} />
      </span>
    );
  }
  if (subtype === 'upsert_stmt') {
    return (
      <span className={`${boxCls} bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0`}>
        <Shuffle className={iconCls} />
      </span>
    );
  }

  switch (kind) {
    case 'start':
      return (
        <span className="w-6 h-6 rounded-full bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5" />
        </span>
      );
    case 'sql':
      return (
        <span className={`${boxCls} bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center shrink-0`}>
          <Database className={iconCls} />
        </span>
      );
    case 'rest':
      return (
        <span className={`${boxCls} bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center shrink-0`}>
          <Zap className={iconCls} />
        </span>
      );
    case 'javascript':
      return (
        <span className={`${boxCls} bg-[#ECFDF5] text-[#059669] flex items-center justify-center shrink-0`}>
          <Code2 className={iconCls} />
        </span>
      );
    case 'ai':
      return (
        <span className={`${boxCls} bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center shrink-0`}>
          <Bot className={iconCls} />
        </span>
      );
    case 'condition':
      return (
        <span className={`${boxCls} bg-[#FEF3C7] text-[#D97706] flex items-center justify-center shrink-0`}>
          <GitBranch className={iconCls} />
        </span>
      );
    case 'alert':
      return (
        <span className={`${boxCls} bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0`}>
          <AlertCircle className={iconCls} />
        </span>
      );
    case 'pdf':
      return (
        <span className={`${boxCls} bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center shrink-0`}>
          <Upload className={iconCls} />
        </span>
      );
    case 's3':
      return (
        <span className={`${boxCls} bg-[#CCFBF1] text-[#0D9488] flex items-center justify-center shrink-0`}>
          <CloudUpload className={iconCls} />
        </span>
      );
  }
}

export function buildDefaultNode(
  item: FunctionCatalogItem,
  x: number,
  y: number,
  defaultConnection?: { id: string; name: string }
): WorkflowNode {
  const id = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const base: WorkflowNode = {
    id,
    kind: item.kind,
    subtype: item.subtype,
    title: item.defaultTitle,
    description: item.description || '',
    x,
    y,
    inputs: [],
    config: {
      loop: false,
      lock: false,
      cacheEnabled: false,
      cacheTtl: 60,
    },
  };

  if (item.kind === 'sql') {
    let query = 'SELECT * FROM weather_data ORDER BY created_at DESC LIMIT 10;';
    if (item.subtype === 'insert' || item.subtype === 'insert_stmt') {
      query =
        "INSERT INTO weather_data (location, date, temperature, condition)\nVALUES ('Toronto', '2026-11-21', 7.5, 'Clear');";
    } else if (item.subtype === 'update') {
      query = "UPDATE weather_data SET condition = 'Sunny' WHERE location = 'Toronto';";
    } else if (item.subtype === 'delete' || item.subtype === 'delete_stmt') {
      query = "DELETE FROM weather_data WHERE date < '2025-01-01';";
    } else if (item.subtype === 'upsert_stmt') {
      query =
        "INSERT INTO weather_data (location, date, temperature, condition)\nVALUES ('Toronto', '2026-11-21', 7.5, 'Clear');";
    }
    base.config = {
      ...base.config,
      connectionId: defaultConnection?.id,
      connectionName: defaultConnection?.name || 'Northwinds DB',
      query,
    };
  } else if (item.kind === 'rest') {
    base.config = {
      ...base.config,
      method: 'GET',
      url: 'https://api.open-meteo.com/v1/forecast?latitude=43.65&longitude=-79.38&current=temperature_2m',
      headers: { Accept: 'application/json' },
    };
  } else if (item.kind === 'javascript') {
    base.config = {
      ...base.config,
      code: `function transform(input, nodes) {\n  return {\n    processedAt: new Date().toISOString(),\n    input\n  };\n}`,
    };
  } else if (item.kind === 'ai') {
    base.config = {
      ...base.config,
      model: 'gemini-4-hydrogen',
      systemInstruction: 'You are a concise data analyst.',
      prompt: 'Analyze the following upstream workflow data and summarize key findings:\n{{input}}',
      responseFormat: 'text',
    };
  } else if (item.kind === 'condition') {
    base.config = {
      ...base.config,
      expression: 'Array.isArray(input?.rows) ? input.rows.length > 0 : Boolean(input)',
      trueBranchLabel: '1',
      falseBranchLabel: '2',
    };
  } else if (item.kind === 'alert') {
    base.config = {
      ...base.config,
      alertTitle: 'Workflow Alert Triggered',
      alertCondition: 'true',
      severity: 'warning',
    };
  } else if (item.kind === 'pdf') {
    base.config = {
      ...base.config,
      pdfTitle: 'WireLogic Automation Report',
      pdfTemplate: 'summary',
    };
  } else if (item.kind === 's3') {
    base.config = {
      ...base.config,
      s3KeyPrefix: 'wirelogic-exports/',
      s3ContentType: 'application/pdf',
    };
  }

  return base;
}
