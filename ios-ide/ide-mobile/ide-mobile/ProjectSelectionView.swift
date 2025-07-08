//
//  ProjectSelectionView.swift
//  ide-mobile
//
//  Created by Claude on 7/8/25.
//

import SwiftUI

struct ProjectSelectionView: View {
    @State private var projects: [Project] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    var onProjectSelected: (Project) -> Void
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Header
                HStack {
                    Spacer()
                    
                    VStack(spacing: 8) {
                        Image("app-icon")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 40, height: 40)
                        
                        Text("Open project")
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)
                    }
                    
                    Spacer()
                }
                .padding(.vertical, 20)
                .background(Color(UIColor.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 1, x: 0, y: 1)
                
                // Content
                if isLoading {
                    Spacer()
                    ProgressView("Loading projects...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Spacer()
                } else if let errorMessage = errorMessage {
                    Spacer()
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 48))
                            .foregroundColor(.orange)
                        
                        Text("Error loading projects")
                            .font(.headline)
                        
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)
                        
                        Button("Retry") {
                            loadProjects()
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                    .padding()
                    Spacer()
                } else if projects.isEmpty {
                    Spacer()
                    VStack(spacing: 16) {
                        Image(systemName: "folder")
                            .font(.system(size: 48))
                            .foregroundColor(.gray)
                        
                        Text("No projects found")
                            .font(.headline)
                            .foregroundColor(.gray)
                        
                        Text("Create a new project to get started")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                    .padding()
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(projects) { project in
                                ProjectCard(project: project) {
                                    onProjectSelected(project)
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                    }
                }
            }
            .navigationBarHidden(true)
        }
        .onAppear {
            loadProjects()
        }
    }
    
    private func loadProjects() {
        isLoading = true
        errorMessage = nil
        
        BackendService.shared.fetchProjects { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let fetchedProjects):
                    self.projects = fetchedProjects
                    self.isLoading = false
                case .failure(let error):
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }
}

struct ProjectCard: View {
    let project: Project
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Emoji section (30% of width)
                Text(project.emoji)
                    .font(.system(size: 40))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .frame(maxWidth: UIScreen.main.bounds.width * 0.3)
                
                // Project info section (70% of width)
                VStack(alignment: .leading, spacing: 8) {
                    Text(project.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.leading)
                    
                    if let description = project.description, !description.isEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    } else {
                        Text("No description")
                            .font(.caption)
                            .foregroundColor(.gray.opacity(0.6))
                            .italic()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(UIColor.secondarySystemBackground))
                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    ProjectSelectionView { project in
        print("Selected project: \(project.name)")
    }
}