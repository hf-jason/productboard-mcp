import { BaseTool } from '../base.js';
import { ProductboardAPIClient } from '@api/client.js';
import { Logger } from '@utils/logger.js';
import { Permission, AccessLevel } from '@auth/permissions.js';

interface GetNoteParams {
  id: string;
}

export class GetNoteTool extends BaseTool<GetNoteParams> {
  constructor(apiClient: ProductboardAPIClient, logger: Logger) {
    super(
      'pb_note_get',
      'Get a single customer feedback note by ID',
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            description: 'Note ID (UUID)',
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

  protected async executeInternal(params: GetNoteParams): Promise<unknown> {
    this.logger.info('Getting note', { noteId: params.id });

    const response = await this.apiClient.get(`/notes/${params.id}`);

    const note = (response as any).data || response;

    const stripHtml = (s: string) =>
      s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

    const fields = note.fields || {};
    const content = fields.content ? stripHtml(fields.content) : '';
    const title = fields.name || (content ? content.substring(0, 60) : 'Untitled Note');

    const tags: string[] = Array.isArray(fields.tags)
      ? fields.tags.map((t: any) => t.name || t).filter(Boolean)
      : [];

    const relationships: any[] = Array.isArray(note.relationships?.data) ? note.relationships.data : [];
    const customers = relationships.filter((r: any) => r.type === 'customer');
    const linkedFeatures = relationships.filter((r: any) => r.type === 'link' && r.target?.type === 'feature');

    const resolveEntity = async (id: string): Promise<{ name: string; email: string }> => {
      try {
        const entity = await this.apiClient.get(`/entities/${id}`);
        const f = (entity as any).data?.fields || {};
        return { name: f.name || '', email: f.email || '' };
      } catch {
        return { name: '', email: '' };
      }
    };

    const formatUser = (base: any, resolved: { name: string; email: string }) => {
      const email = base?.email || resolved.email || '';
      const name = resolved.name || '';
      const id = base?.id || '';
      return [name, email, id ? `(${id})` : ''].filter(Boolean).join(' ') || 'Unknown';
    };

    // Resolve owner, creator, and customer names in parallel
    const [ownerResolved, creatorResolved, ...resolvedCustomers] = await Promise.all([
      fields.owner?.id ? resolveEntity(fields.owner.id) : Promise.resolve({ name: '', email: '' }),
      fields.creator?.id ? resolveEntity(fields.creator.id) : Promise.resolve({ name: '', email: '' }),
      ...customers.map(async (r: any) => {
        const id: string = r.target?.id;
        const type: string = r.target?.type || 'company';
        try {
          const entity = await this.apiClient.get(`/entities/${id}`);
          const name = (entity as any).data?.fields?.name || (entity as any).data?.fields?.email || id;
          return `${name} (${type}/${id})`;
        } catch {
          return `${type}/${id}`;
        }
      }),
    ]);

    const lines = [
      `ID: ${note.id}`,
      `Type: ${note.type || 'textNote'}`,
      `Title: ${title}`,
      `Content: ${content}`,
      ``,
      `Owner: ${fields.owner?.id ? formatUser(fields.owner, ownerResolved as { name: string; email: string }) : 'Unknown'}`,
      `Creator: ${fields.creator?.id ? formatUser(fields.creator, creatorResolved as { name: string; email: string }) : 'Unknown'}`,
      ``,
      `Processed: ${fields.processed ?? 'Unknown'}`,
      `Archived: ${fields.archived ?? 'Unknown'}`,
      ``,
      `Tags: ${tags.length > 0 ? tags.join(', ') : 'None'}`,
      ``,
      `Linked customers: ${resolvedCustomers.length > 0 ? resolvedCustomers.join(', ') : 'None'}`,
      `Linked features: ${linkedFeatures.length > 0
        ? linkedFeatures.map((r: any) => r.target.id).join(', ')
        : 'None'}`,
      ``,
      `Created: ${note.createdAt || 'Unknown'}`,
      `Updated: ${note.updatedAt || 'Unknown'}`,
      `API URL: ${note.links?.self || ''}`,
      `Productboard URL: ${note.links?.html || ''}`,
    ];

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
      data: note,
    };
  }
}
