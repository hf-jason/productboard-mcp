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

    const relationships: any[] = Array.isArray(note.relationships) ? note.relationships : [];
    const customers = relationships.filter((r: any) => r.type === 'customer');
    const linkedFeatures = relationships.filter((r: any) => r.type === 'link' && r.target?.type === 'feature');

    const lines = [
      `ID: ${note.id}`,
      `Type: ${note.type || 'textNote'}`,
      `Title: ${title}`,
      `Content: ${content}`,
      ``,
      `Owner: ${fields.owner?.email || 'Unknown'} ${fields.owner?.id ? `(${fields.owner.id})` : ''}`.trim(),
      `Creator: ${fields.creator?.email || 'Unknown'} ${fields.creator?.id ? `(${fields.creator.id})` : ''}`.trim(),
      ``,
      `Processed: ${fields.processed ?? 'Unknown'}`,
      `Archived: ${fields.archived ?? 'Unknown'}`,
      ``,
      `Tags: ${tags.length > 0 ? tags.join(', ') : 'None'}`,
      ``,
      `Linked customers: ${customers.length > 0
        ? customers.map((r: any) => `${r.target.type}/${r.target.id}`).join(', ')
        : 'None'}`,
      `Linked features: ${linkedFeatures.length > 0
        ? linkedFeatures.map((r: any) => r.target.id).join(', ')
        : 'None'}`,
      ``,
      `Created: ${note.createdAt || 'Unknown'}`,
      `Updated: ${note.updatedAt || 'Unknown'}`,
      `URL: ${note.links?.self || ''}`,
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
