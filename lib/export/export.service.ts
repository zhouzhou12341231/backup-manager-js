import {
    ContentItemContracts,
    ContentTypeContracts,
    ContentTypeSnippetContracts,
    LanguageVariantContracts,
    ManagementClient,
    TaxonomyContracts,
    AssetContracts,
    LanguageContracts,
    AssetFolderContracts,
    ProjectContracts,
    WorkflowContracts,
    WebhookContracts,
    CollectionContracts
} from '@kontent-ai/management-sdk';
import { HttpService } from '@kontent-ai/core-sdk';

import { IExportAllResult, IExportConfig, IExportData } from './export.models';
import { defaultRetryStrategy, ItemType, printProjectInfoToConsoleAsync } from '../core';
import { version } from '../../package.json';
import { green, red, yellow } from 'colors';

export class ExportService {
    private readonly client: ManagementClient;

    constructor(private config: IExportConfig) {
        this.client = new ManagementClient({
            apiKey: config.apiKey,
            projectId: config.projectId,
            baseUrl: config.baseUrl,
            httpService: new HttpService({
                logErrorsToConsole: false
            }),
            retryStrategy: config.retryStrategy ?? defaultRetryStrategy
        });
    }

    public async exportAllAsync(): Promise<IExportAllResult> {
        const exportItems = {
            asset: this.config.exportFilter?.includes('asset') ?? true,
            assetFolder: this.config.exportFilter?.includes('assetFolder') ?? true,
            binaryFile: this.config.exportFilter?.includes('binaryFile') ?? true,
            contentItem: this.config.exportFilter?.includes('contentItem') ?? true,
            collections: this.config.exportFilter?.includes('collection') ?? true,
            contentType: this.config.exportFilter?.includes('contentType') ?? true,
            contentTypeSnippet: this.config.exportFilter?.includes('contentTypeSnippet') ?? true,
            language: this.config.exportFilter?.includes('language') ?? true,
            languageVariant: this.config.exportFilter?.includes('languageVariant') ?? true,
            taxonomy: this.config.exportFilter?.includes('taxonomy') ?? true,
            webhooks: this.config.exportFilter?.includes('webhook') ?? true,
            workflows: this.config.exportFilter?.includes('workflow') ?? true
        };

        let projectValidation: string | ProjectContracts.IProjectReportResponseContract;
        let isInconsistentExport: boolean = false;

        await printProjectInfoToConsoleAsync(this.client);

        if (!this.config.skipValidation) {
            console.log(green('Running project validation'));
            projectValidation = await this.exportProjectValidationAsync();
            isInconsistentExport =
                projectValidation.type_issues.length > 0 || projectValidation.variant_issues.length > 0;
            console.log(
                `Project validation results: ${
                    projectValidation.type_issues.length
                        ? red(projectValidation.type_issues.length.toString())
                        : green('0')
                } type issues, ${
                    projectValidation.variant_issues.length
                        ? red(projectValidation.variant_issues.length.toString())
                        : green('0')
                } variant issues`
            );
            console.log('Projects with type or variant issues might not get imported back successfully');
        } else {
            console.log(red('Skipping project validation'));
            projectValidation = '{}';
        }

        console.log();

        const contentTypes = await this.exportContentTypesAsync({ processItem: exportItems.contentType });
        const languages = await this.exportLanguagesAsync();
        const contentItems =
            exportItems.contentItem || exportItems.languageVariant ? await this.exportContentItemsAsync() : [];

        const data: IExportData = {
            contentTypes: exportItems.contentType ? contentTypes : [],
            contentTypeSnippets: exportItems.contentTypeSnippet ? await this.exportContentTypeSnippetsAsync() : [],
            taxonomies: exportItems.taxonomy ? await this.exportTaxonomiesAsync() : [],
            webhooks: exportItems.webhooks ? await this.exportWebhooksAsync() : [],
            workflows: exportItems.workflows ? await this.exportWorkflowsAsync() : [],
            contentItems: exportItems.contentItem ? await this.exportContentItemsAsync() : [],
            collections: exportItems.collections ? await this.exportCollectionsAsync() : [],
            languageVariants: exportItems.languageVariant
                ? await this.exportLanguageVariantsAsync(contentItems, languages)
                : [],
            assets: exportItems.asset ? await this.exportAssetsAsync() : [],
            languages: exportItems.language ? languages : [],
            assetFolders: exportItems.assetFolder ? await this.exportAssetFoldersAsync() : []
        };

        return {
            metadata: {
                version,
                timestamp: new Date(),
                projectId: this.config.projectId,
                isInconsistentExport,
                dataOverview: {
                    assetFoldersCount: data.assetFolders.length,
                    assetsCount: data.assets.length,
                    contentItemsCount: data.contentItems.length,
                    contentTypeSnippetsCount: data.contentTypeSnippets.length,
                    contentTypesCount: data.contentTypes.length,
                    languageVariantsCount: data.languageVariants.length,
                    languagesCount: data.languages.length,
                    taxonomiesCount: data.taxonomies.length,
                    workflowsCount: data.workflows.length,
                    webhooksCount: data.webhooks.length,
                    collectionsCount: data.collections.length
                }
            },
            validation: projectValidation,
            data
        };
    }

    public async exportProjectValidationAsync(): Promise<ProjectContracts.IProjectReportResponseContract> {
        const response = await this.client.validateProjectContent().projectId(this.config.projectId).toPromise();
        return response.rawData;
    }

    public async exportAssetsAsync(): Promise<AssetContracts.IAssetModelContract[]> {
        const response = await this.client
            .listAssets()
            .withListQueryConfig({
                responseFetched: (listResponse, token) => {
                    listResponse.data.items.forEach((m) => this.processItem(m.fileName, 'asset', m));
                }
            })
            .toAllPromise();
        return response.data.items.map((m) => m._raw);
    }

    public async exportAssetFoldersAsync(): Promise<AssetFolderContracts.IAssetFolderContract[]> {
        const response = await this.client.listAssetFolders().toPromise();
        response.data.items.forEach((m) => this.processItem(m.name, 'assetFolder', m));
        return response.data.items.map((m) => m._raw);
    }

    public async exportLanguagesAsync(): Promise<LanguageContracts.ILanguageModelContract[]> {
        const response = await this.client
            .listLanguages()
            .withListQueryConfig({
                responseFetched: (listResponse, token) => {
                    listResponse.data.items.forEach((m) => this.processItem(m.name, 'language', m));
                }
            })
            .toAllPromise();
        return response.data.items.map((m) => m._raw);
    }

    public async exportWorkflowsAsync(): Promise<WorkflowContracts.IWorkflowContract[]> {
        const response = await this.client.listWorkflows().toPromise();
        response.data.forEach((m) => this.processItem(m.name, 'workflow', m));
        return response.data.map((m) => m._raw);
    }

    public async exportTaxonomiesAsync(): Promise<TaxonomyContracts.ITaxonomyContract[]> {
        const response = await this.client.listTaxonomies().toAllPromise();
        response.data.items.forEach((m) => this.processItem(m.name, 'taxonomy', m));
        return response.data.items.map((m) => m._raw);
    }

    public async exportWebhooksAsync(): Promise<WebhookContracts.IWebhookContract[]> {
        const response = await this.client.listWebhooks().toPromise();
        response.data.webhooks.forEach((m) => this.processItem(m.name, 'webhook', m));
        return response.data.webhooks.map((m) => m._raw);
    }

    public async exportCollectionsAsync(): Promise<CollectionContracts.ICollectionContract[]> {
        const response = await this.client.listCollections().toPromise();
        response.data.collections.forEach((m) => this.processItem(m.name, 'collection', m));
        return response.data.collections.map((m) => m._raw);
    }

    public async exportContentTypeSnippetsAsync(): Promise<ContentTypeSnippetContracts.IContentTypeSnippetContract[]> {
        const response = await this.client
            .listContentTypeSnippets()
            .withListQueryConfig({
                responseFetched: (listResponse, token) => {
                    listResponse.data.items.forEach((m) => this.processItem(m.name, 'contentTypeSnippet', m));
                }
            })
            .toAllPromise();
        return response.data.items.map((m) => m._raw);
    }

    public async exportContentTypesAsync(data: {
        processItem: boolean;
    }): Promise<ContentTypeContracts.IContentTypeContract[]> {
        const response = await this.client
            .listContentTypes()
            .withListQueryConfig({
                responseFetched: (listResponse, token) => {
                    if (data.processItem) {
                        listResponse.data.items.forEach((m) => this.processItem(m.name, 'contentType', m));
                    }
                }
            })
            .toAllPromise();
        return response.data.items.map((m) => m._raw);
    }

    public async exportContentItemsAsync(): Promise<ContentItemContracts.IContentItemModelContract[]> {
        const response = await this.client
            .listContentItems()
            .withListQueryConfig({
                responseFetched: (listResponse, token) => {
                    listResponse.data.items.forEach((m) => this.processItem(m.name, 'contentItem', m));
                }
            })
            .toAllPromise();
        return response.data.items.map((m) => m._raw);
    }

    public async exportLanguageVariantsAsync(
        contentItems: ContentItemContracts.IContentItemModelContract[],
        languages: LanguageContracts.ILanguageModelContract[]
    ): Promise<LanguageVariantContracts.ILanguageVariantModelContract[]> {
        const languageVariants: LanguageVariantContracts.ILanguageVariantModelWithComponentsContract[] = [];

        for (const contentItem of contentItems) {
            const response = await this.client.listLanguageVariantsOfItem().byItemId(contentItem.id).toPromise();

            languageVariants.push(...response.data.items.map((m) => m._raw));

            for (const languageVariant of response.data.items) {
                const language = languages.find((m) => m.id === languageVariant.language.id);

                this.processItem(
                    `${contentItem.name} (${yellow(language?.name ?? '')})`,
                    'languageVariant',
                    languageVariant
                );
            }
        }

        return languageVariants;
    }

    private processItem(title: string, type: ItemType, data: any): void {
        if (!this.config.onExport) {
            return;
        }

        this.config.onExport({
            data,
            title,
            type
        });
    }
}
