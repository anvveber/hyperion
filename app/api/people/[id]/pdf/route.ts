import { renderToBuffer } from '@react-pdf/renderer';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { contentDisposition } from '@/lib/file-range';
import { buildPersonPdfModel } from '@/lib/person-pdf/model';
import { registerPdfFonts } from '@/lib/person-pdf/fonts';
import { PersonPdfDocument } from '@/lib/person-pdf/document';

// Rendering uses Node APIs (fonts and images from disk).
export const runtime = 'nodejs';

// GET /api/people/[id]/pdf - Download one person's profile as a PDF (?transcripts=1 appends recording transcripts)
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    const includeTranscripts = new URL(request.url).searchParams.get('transcripts') === '1';
    const model = await buildPersonPdfModel(session.user.id, id, { includeTranscripts });
    if (!model) {
      return apiResponse.notFound('Person not found');
    }

    registerPdfFonts();
    // PersonPdfDocument has no hooks, so calling it returns the <Document> element
    // renderToBuffer expects.
    const pdf = await renderToBuffer(PersonPdfDocument({ model }));

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': contentDisposition('attachment', `${model.fileBaseName}.pdf`),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleApiError(error, 'people-pdf');
  }
});
