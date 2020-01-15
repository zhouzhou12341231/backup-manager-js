import { AssetFolderModels, IManagementClient, ManagementClient } from '@kentico/kontent-management';

import { ItemType } from '../core';
import { ICleanConfig, ICleanResult } from './clean.models';

export class CleanService {
    private readonly client: IManagementClient;

    constructor(private config: ICleanConfig) {
        this.client = new ManagementClient({
            apiKey: config.apiKey,
            projectId: config.projectId
        });
    }

    public async cleanAllAsync(): Promise<ICleanResult> {
        try {
            await this.cleanContentItemsAsync();
            await this.cleanContentTypesAsync();
            await this.cleanContentTypeSnippetsAsync();
            await this.cleanTaxonomiesAsync();
            await this.cleanAssetsAsync();
            await this.cleanAssetFoldersAsync();

            return {
                metadata: {
                    projectId: this.config.projectId,
                    timestamp: new Date()
                }
            };
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    public async cleanTaxonomiesAsync(): Promise<void> {
        const taxonomies = (await this.client.listTaxonomies().toPromise()).data.taxonomies;

        for (const taxonomy of taxonomies) {
            await this.client
                .deleteTaxonomy()
                .byTaxonomyId(taxonomy.id)
                .toPromise()
                .then(m => {
                    this.processItem(taxonomy.name, 'taxonomy', taxonomy);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanContentTypeSnippetsAsync(): Promise<void> {
        const contentTypeSnippets = (await this.client.listContentTypeSnippets().toAllPromise()).data.items;

        for (const contentTypeSnippet of contentTypeSnippets) {
            await this.client
                .deleteContentTypeSnippet()
                .byTypeId(contentTypeSnippet.id)
                .toPromise()
                .then(m => {
                    this.processItem(contentTypeSnippet.name, 'contentTypeSnippet', contentTypeSnippet);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanContentTypesAsync(): Promise<void> {
        const contentTypes = (await this.client.listContentTypes().toAllPromise()).data.items;

        for (const contentType of contentTypes) {
            await this.client
                .deleteContentType()
                .byTypeId(contentType.id)
                .toPromise()
                .then(m => {
                    this.processItem(contentType.name, 'contentType', contentType);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanAssetsAsync(): Promise<void> {
        const assets = (await this.client.listAssets().toAllPromise()).data.items;

        for (const asset of assets) {
            await this.client
                .deleteAsset()
                .byAssetId(asset.id)
                .toPromise()
                .then(m => {
                    this.processItem(asset.fileName, 'asset', asset);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanAssetFoldersAsync(): Promise<void> {
        const assetFolders = (await this.client.listAssetFolders().toPromise()).data.items;

        if (assetFolders.length) {
            await this.client
                .modifyAssetFolders()
                .withData(
                    assetFolders.map(m => {
                        return <AssetFolderModels.IModifyAssetFoldersData>{
                            op: 'remove',
                            reference: {
                                id: m.id
                            }
                        };
                    })
                )
                .toPromise()
                .then(response => {
                    for (const folder of assetFolders) {
                        this.processItem(folder.name, 'assetFolder', folder);
                    }
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanContentItemsAsync(): Promise<void> {
        const contentItems = (await this.client.listContentItems().toAllPromise()).data.items;

        for (const contentItem of contentItems) {
            await this.client
                .deleteContentItem()
                .byItemId(contentItem.id)
                .toPromise()
                .then(m => {
                    this.processItem(contentItem.name, 'contentItem', contentItem);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    public async cleanLanguageVariantsAsync(contentItemId: string): Promise<void> {
        const languageVariants = (
            await this.client
                .listLanguageVariantsOfItem()
                .byItemId(contentItemId)
                .toPromise()
        ).data.items;

        for (const languageVariant of languageVariants) {
            const languageId = languageVariant.language.id;
            const itemId = contentItemId;

            if (!languageId) {
                throw Error(`Missing language id for item '${contentItemId}'`);
            }

            await this.client
                .deleteLanguageVariant()
                .byItemId(itemId)
                .byLanguageId(languageId)
                .toPromise()
                .then(m => {
                    this.processItem(itemId, 'languageVariant', languageVariant);
                })
                .catch(error => this.handleCleanError(error));
        }
    }

    private handleCleanError(error: any): void {
        console.log(error);
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
