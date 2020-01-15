import {
    AssetContracts,
    AssetModels,
    ContentItemContracts,
    ContentItemModels,
    ContentTypeContracts,
    ContentTypeModels,
    ContentTypeSnippetContracts,
    ContentTypeSnippetModels,
    IManagementClient,
    LanguageContracts,
    LanguageModels,
    LanguageVariantContracts,
    LanguageVariantModels,
    ManagementClient,
    TaxonomyContracts,
    TaxonomyModels,
} from '@kentico/kontent-management';

import { idTranslateHelper, IImportItemResult, ItemType, ValidImportContract, ValidImportModel } from '../core';
import { importHelper } from './import.helper';
import { IBinaryFile, IImportConfig, IImportData, IImportSource, IPreparedImportItem } from './import.models';

export class ImportService {
    private readonly client: IManagementClient;

    constructor(private config: IImportConfig) {
        this.client = new ManagementClient({
            apiKey: config.apiKey,
            projectId: config.projectId
        });
    }

    public async importFromSourceAsync(
        sourceData: IImportSource
    ): Promise<IImportItemResult<ValidImportContract, ValidImportModel>[]> {
        const importData = importHelper.prepareImportData(sourceData);
        return await this.importAsync(importData);
    }

    public async importAsync(
        importData: IImportData
    ): Promise<IImportItemResult<ValidImportContract, ValidImportModel>[]> {
        const importedItems: IImportItemResult<ValidImportContract, ValidImportModel>[] = [];

        for (const item of importData.orderedImportItems) {
            const importedItem = await this.importItemAsync(item, importData.binaryFiles, importedItems);
            importedItems.push(...importedItem);
        }

        return importedItems;
    }

    public async importItemAsync(
        item: IPreparedImportItem,
        binaryFiles: IBinaryFile[],
        currentItems: IImportItemResult<ValidImportContract, ValidImportModel>[]
    ): Promise<IImportItemResult<ValidImportContract, ValidImportModel>[]> {
        if (item.type === 'contentType') {
            return await this.importContentTypesAsync([item.item]);
        } else if (item.type === 'taxonomy') {
            return await this.importTaxonomiesAsync([item.item]);
        } else if (item.type === 'contentTypeSnippet') {
            return await this.importContentTypeSnippetsAsync([item.item]);
        } else if (item.type === 'contentItem') {
            return await this.importContentItemAsync([item.item]);
        } else if (item.type === 'languageVariant') {
            return await this.importLanguageVariantsAsync([item.item], currentItems);
        } else if (item.type === 'language') {
            if (this.config.skip?.languages === true) {
                return [];
            }
            return await this.importLanguagesAsync([item.item]);
        } else if (item.type === 'asset') {
            return await this.importAssetsAsync([item.item], binaryFiles);
        } else {
            throw Error(`Not supported import data type '${item.type}'`);
        }
    }

    public async importLanguagesAsync(
        languages: LanguageContracts.ILanguageModelContract[]
    ): Promise<IImportItemResult<LanguageContracts.ILanguageModelContract, LanguageModels.LanguageModel>[]> {
        const importedItems: IImportItemResult<
            LanguageContracts.ILanguageModelContract,
            LanguageModels.LanguageModel
        >[] = [];

        for (const language of languages) {
            // 'codename' property is set in codename translator
            const fallbackLanguageCodename = (language.fallback_language as any).codename;

            if (!fallbackLanguageCodename) {
                throw Error(`Langauge '${language.name}' has unset codename`);
            }

            await this.client
                .addLanguage()
                .withData({
                    codename: language.codename,
                    name: language.name,
                    external_id: language.external_id,
                    fallback_language:
                        language.codename === fallbackLanguageCodename
                            ? { id: '00000000-0000-0000-0000-000000000000' }
                            : { codename: fallbackLanguageCodename },
                    is_active: language.is_active
                })
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: language,
                        importId: response.data.id,
                        originalId: language.id
                    });
                    this.processItem(response.data.name, 'language', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    public async importAssetsAsync(
        assets: AssetContracts.IAssetModelContract[],
        binaryFiles: IBinaryFile[]
    ): Promise<IImportItemResult<AssetContracts.IAssetModelContract, AssetModels.Asset>[]> {
        const importedItems: IImportItemResult<AssetContracts.IAssetModelContract, AssetModels.Asset>[] = [];

        for (const asset of assets) {
            const binaryFile = binaryFiles.find(m => m.asset.id === asset.id);

            if (!binaryFile) {
                throw Error(`Could not find binary file for asset with id '${asset.id}'`);
            }

            const uploadedBinaryFile = await this.client
                .uploadBinaryFile()
                .withData({
                    binaryData: binaryFile.binaryData,
                    contentType: asset.type,
                    filename: asset.file_name
                })
                .toPromise();

            await this.client
                .addAsset()
                .withData({
                    descriptions: asset.descriptions,
                    file_reference: uploadedBinaryFile.data,
                    title: asset.title,
                    external_id: asset.external_id
                })
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: asset,
                        importId: response.data.id,
                        originalId: asset.id
                    });
                    this.processItem(response.data.fileName, 'asset', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    public async importContentTypesAsync(
        contentTypes: ContentTypeContracts.IContentTypeContract[]
    ): Promise<IImportItemResult<ContentTypeContracts.IContentTypeContract, ContentTypeModels.ContentType>[]> {
        const importedItems: IImportItemResult<
            ContentTypeContracts.IContentTypeContract,
            ContentTypeModels.ContentType
        >[] = [];

        for (const contentType of contentTypes) {
            await this.client
                .addContentType()
                .withData(builder => {
                    return contentType;
                })
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: contentType,
                        importId: response.data.id,
                        originalId: contentType.id
                    });
                    this.processItem(response.data.name, 'contentType', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    public async importContentItemAsync(
        contentItems: ContentItemContracts.IContentItemModelContract[]
    ): Promise<IImportItemResult<ContentItemContracts.IContentItemModelContract, ContentItemModels.ContentItem>[]> {
        const importedItems: IImportItemResult<
            ContentItemContracts.IContentItemModelContract,
            ContentItemModels.ContentItem
        >[] = [];

        for (const contentItem of contentItems) {
            const typeCodename = (contentItem.type as any).codename;

            if (!typeCodename) {
                throw Error(`Content item '${contentItem.codename}' has unset type codename`);
            }

            await this.client
                .addContentItem()
                .withData({
                    name: contentItem.name,
                    type: {
                        codename: typeCodename
                    },
                    codename: contentItem.codename,
                    external_id: contentItem.external_id
                })
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: contentItem,
                        importId: response.data.id,
                        originalId: contentItem.id
                    });
                    this.processItem(response.data.name, 'contentItem', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    public async importLanguageVariantsAsync(
        languageVariants: LanguageVariantContracts.ILanguageVariantModelContract[],
        currentItems: IImportItemResult<ValidImportContract, ValidImportModel>[]
    ): Promise<
        IImportItemResult<
            LanguageVariantContracts.ILanguageVariantModelContract,
            LanguageVariantModels.ContentItemLanguageVariant
        >[]
    > {
        const importedItems: IImportItemResult<
            LanguageVariantContracts.ILanguageVariantModelContract,
            LanguageVariantModels.ContentItemLanguageVariant
        >[] = [];

        for (const languageVariant of languageVariants) {
            const itemCodename: string | undefined = languageVariant.item.codename;
            const languageCodename: string | undefined = languageVariant.language.codename;

            if (!itemCodename) {
                throw Error(`Missing item codename for item`);
            }
            if (!languageCodename) {
                throw Error(`Missing language codename for item`);
            }

            // replace ids in assets with new ones
            idTranslateHelper.replaceIdReferencesWithNewId(languageVariant, currentItems);

            // set workflow id (there is no API to create workflows programatically)
            languageVariant.workflow_step.id = this.config.workflowIdForImportedItems;

            await this.client
                .upsertLanguageVariant()
                .byItemCodename(itemCodename)
                .byLanguageCodename(languageCodename)
                .withElements(languageVariant.elements)
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: languageVariant,
                        importId: response.data.item.id,
                        originalId: languageVariant.item.id
                    });
                    this.processItem(`${itemCodename} (${languageCodename})`, 'languageVariant', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    public async importContentTypeSnippetsAsync(
        contentTypeSnippets: ContentTypeSnippetContracts.IContentTypeSnippetContract[]
    ): Promise<IImportItemResult<ContentTypeContracts.IContentTypeContract, ContentTypeModels.ContentType>[]> {
        const importedContentTypeSnippets: IImportItemResult<
            ContentTypeContracts.IContentTypeContract,
            ContentTypeSnippetModels.ContentTypeSnippet
        >[] = [];

        for (const contentTypeSnippet of contentTypeSnippets) {
            await this.client
                .addContentTypeSnippet()
                .withData(builder => {
                    return contentTypeSnippet;
                })
                .toPromise()
                .then(response => {
                    importedContentTypeSnippets.push({
                        imported: response.data,
                        original: contentTypeSnippet,
                        importId: response.data.id,
                        originalId: contentTypeSnippet.id
                    });
                    this.processItem(response.data.name, 'contentTypeSnippet', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedContentTypeSnippets;
    }

    public async importTaxonomiesAsync(
        taxonomies: TaxonomyContracts.ITaxonomyContract[]
    ): Promise<IImportItemResult<TaxonomyContracts.ITaxonomyContract, TaxonomyModels.Taxonomy>[]> {
        const importedItems: IImportItemResult<TaxonomyContracts.ITaxonomyContract, TaxonomyModels.Taxonomy>[] = [];

        for (const taxonomy of taxonomies) {
            await this.client
                .addTaxonomy()
                .withData(taxonomy)
                .toPromise()
                .then(response => {
                    importedItems.push({
                        imported: response.data,
                        original: taxonomy,
                        importId: response.data.id,
                        originalId: taxonomy.id
                    });
                    this.processItem(response.data.name, 'taxonomy', response.data);
                })
                .catch(error => this.handleImportError(error));
        }

        return importedItems;
    }

    private handleImportError(error: any): void {
        console.log(error);
        throw Error(error);
    }

    private processItem(title: string, type: ItemType, data: any): void {
        if (!this.config.processItem) {
            return;
        }

        this.config.processItem({
            data,
            title,
            type
        });
    }
}
