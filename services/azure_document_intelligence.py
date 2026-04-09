import os
from azure.core.credentials import AzureKeyCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient

def image_to_string_azure(image_bytes: bytes) -> str:
    endpoint = os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"]
    key = os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"]

    print(f"Using Azure Document Intelligence with endpoint: {endpoint}")
    client = DocumentIntelligenceClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key),
    )

    poller = client.begin_analyze_document(
        "prebuilt-read",
        body=image_bytes,
    )
    result = poller.result()
    return result.content

