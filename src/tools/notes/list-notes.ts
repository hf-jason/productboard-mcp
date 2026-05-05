import { BaseTool } from '../base.js';
import { ProductboardAPIClient } from '@api/index.js';
import { Logger } from '@utils/logger.js';
import { Permission, AccessLevel } from '@auth/permissions.js';

interface ListNotesParams {
  processed?: boolean;
  archived?: boolean;
  owner_email?: string;
  owner_id?: string;
  creator_email?: string;
  creator_id?: string;
  source_record_id?: string;
  metadata_source_system?: string;
  metadata_source_record_id?: string;
  created_from?: string;
  created_to?: string;
  updated_from?: string;
  updated_to?: string;
  limit?: number;
}

export class ListNotesTool extends BaseTool<ListNotesParams> {
  constructor(apiClient: ProductboardAPIClient, logger: Logger) {
    super(
      'pb_note_list',
      'List customer feedback notes',
      {
        type: 'object',
        properties: {
          processed: {
            type: 'boolean',
            description: 'Filter by processed state',
          },
          archived: {
            type: 'boolean',
            description: 'Filter by archived state. Note: archived notes always return processed=false regardless of actual state',
          },
          owner_email: {
            type: 'string',
            description: 'Filter by owner email address',
          },
          owner_id: {
            type: 'string',
            description: 'Filter by owner ID',
          },
          creator_email: {
            type: 'string',
            description: 'Filter by creator email address',
          },
          creator_id: {
            type: 'string',
            description: 'Filter by creator ID',
          },
          source_record_id: {
            type: 'string',
            description: 'Filter by source record ID',
          },
          metadata_source_system: {
            type: 'string',
            description: 'Filter by metadata source system',
          },
          metadata_source_record_id: {
            type: 'string',
            description: 'Filter by metadata source record ID',
          },
          created_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created from this date-time',
          },
          created_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes created up to this date-time',
          },
          updated_from: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated from this date-time',
          },
          updated_to: {
            type: 'string',
            format: 'date-time',
            description: 'Filter notes updated up to this date-time',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 5000,
            default: 100,
          },
        },
      },
      {
        requiredPermissions: [Permission.NOTES_READ],
        minimumAccessLevel: AccessLevel.READ,
        description: 'Requires read access to notes',
      },
      apiClient,
      logger
    );
  }

  protected async executeInternal(params: ListNotesParams = {}): Promise<unknown> {
    this.logger.info('Listing notes');

    const queryParams: Record<string, any> = {};

    if (params.processed !== undefined) queryParams.processed = params.processed;
    if (params.archived !== undefined) queryParams.archived = params.archived;
    if (params.owner_email) queryParams['owner[email]'] = params.owner_email;
    if (params.owner_id) queryParams['owner[id]'] = params.owner_id;
    if (params.creator_email) queryParams['creator[email]'] = params.creator_email;
    if (params.creator_id) queryParams['creator[id]'] = params.creator_id;
    if (params.source_record_id) queryParams['source[recordId]'] = params.source_record_id;
    if (params.metadata_source_system) queryParams['metadata[source][system]'] = params.metadata_source_system;
    if (params.metadata_source_record_id) queryParams['metadata[source][recordId]'] = params.metadata_source_record_id;
    if (params.created_from) queryParams.createdFrom = params.created_from;
    if (params.created_to) queryParams.createdTo = params.created_to;
    if (params.updated_from) queryParams.updatedFrom = params.updated_from;
    if (params.updated_to) queryParams.updatedTo = params.updated_to;

    const allNotes = await this.apiClient.getAllPages<any>('/notes', queryParams);
    const limit = params.limit || 100;
    const notes = allNotes.slice(0, limit);

    const stripHtml = (s: string) => s
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

    // Collect unique entity IDs (users + customers) for a single batch resolution
    const entityIds = new Set<string>();
    for (const note of notes) {
      const fields = note.fields || {};
      if (fields.owner?.id) entityIds.add(fields.owner.id);
      if (fields.creator?.id) entityIds.add(fields.creator.id);
      const rels: any[] = Array.isArray(note.relationships?.data) ? note.relationships.data : [];
      for (const r of rels) {
        if (r.type === 'customer' && r.target?.id) entityIds.add(r.target.id);
      }
    }

    const entityCache = new Map<string, { name: string; email: string }>();
    await Promise.all(
      Array.from(entityIds).map(async (id) => {
        try {
          const entity = await this.apiClient.get(`/entities/${id}`);
          const f = (entity as any).data?.fields || {};
          entityCache.set(id, { name: f.name || '', email: f.email || '' });
        } catch {
          entityCache.set(id, { name: '', email: '' });
        }
      })
    );

    const formatUser = (base: any) => {
      const resolved = base?.id ? (entityCache.get(base.id) || { name: '', email: '' }) : { name: '', email: '' };
      const name = resolved.name || '';
      const email = base?.email || resolved.email || '';
      const id = base?.id || '';
      return [name, email, id ? `(${id})` : ''].filter(Boolean).join(' ') || 'Unknown';
    };

    // Format response for MCP protocol
    const formattedNotes = notes.map((note: any) => {
      const fields = note.fields || {};
      const content = fields.content ? stripHtml(fields.content) : '';
      const title = fields.name || (content ? content.substring(0, 60) : 'Untitled Note');
      const tags: string[] = Array.isArray(fields.tags)
        ? fields.tags.map((t: any) => t.name || t).filter(Boolean)
        : [];
      const relationships: any[] = Array.isArray(note.relationships?.data) ? note.relationships.data : [];
      const customers = relationships
        .filter((r: any) => r.type === 'customer')
        .map((r: any) => {
          const id: string = r.target?.id;
          const type: string = r.target?.type || 'company';
          const resolved = entityCache.get(id);
          const label = resolved?.name || resolved?.email || id;
          return `${label} (${type}/${id})`;
        });
      const features = relationships
        .filter((r: any) => r.type === 'link' && r.target?.type === 'feature')
        .map((r: any) => r.target?.id);

      return { id: note.id, title, content, fields, tags, customers, features, createdAt: note.createdAt };
    });

    // Create a text summary of the notes
    const summary = formattedNotes.length > 0
      ? `Found ${allNotes.length} notes total, showing ${formattedNotes.length}:\n\n` +
        formattedNotes.map((n, i) =>
          `${i + 1}. ${n.title}\n` +
          `   ID: ${n.id}\n` +
          `   Created: ${n.createdAt || 'Unknown'}\n` +
          `   Owner: ${formatUser(n.fields?.owner)}\n` +
          `   Creator: ${formatUser(n.fields?.creator)}\n` +
          `   Processed: ${n.fields?.processed ?? 'Unknown'} | Archived: ${n.fields?.archived ?? 'Unknown'}\n` +
          `   Tags: ${n.tags.length > 0 ? n.tags.join(', ') : 'None'}\n` +
          `   Customers: ${n.customers.length > 0 ? n.customers.join(', ') : 'None'}\n` +
          `   Linked features: ${n.features.length > 0 ? n.features.join(', ') : 'None'}\n` +
          `   Content: ${n.content}\n`
        ).join('\n')
      : 'No notes found.';
    
    // Return in MCP expected format
    return {
      content: [
        {
          type: 'text',
          text: summary
        }
      ]
    };
  }
}