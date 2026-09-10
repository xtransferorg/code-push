require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CodePush'
  s.version        = package['version'].gsub(/v|-beta/, '')
  s.summary        = package['description']
  s.author         = package['author']
  s.license        = package['license']
  s.homepage       = package['homepage']
  s.source         = { :git => 'https://github.com/Microsoft/react-native-code-push.git', :tag => "v#{s.version}"}
  s.ios.deployment_target = '7.0'
  s.tvos.deployment_target = '9.0'
  s.preserve_paths = '*.js'
  s.library        = 'z'
	
  s.source_files = 'ios/CodePush/*.{h,m,mm}', 'ios/CodePush/HDiffPatch/*.{h}', 'ios/CodePush/Native/*.{h,m,mm,swift}'
	
  # 指定 Swift 版本，确保生成 <ProductModuleName>-Swift.h
  s.swift_version = '5.0'
  s.public_header_files = [
    'ios/CodePush/CodePush.h',
    'ios/CodePush/Native/*.h'
  ]
	
  # 指定静态库路径
  s.vendored_libraries = 'ios/CodePush/HDiffPatch/libhpatchz.a'
  # Note: Even though there are copy/pasted versions of some of these dependencies in the repo, 
  # we explicitly let CocoaPods pull in the versions below so all dependencies are resolved and 
  # linked properly at a parent workspace level.
  s.dependency 'React'
  s.dependency 'SSZipArchive', '2.2.2'
  s.dependency 'JWT', '3.0.0-beta.12'
  s.dependency 'Base64', '1.1.2'

  # Use install_modules_dependencies helper to install the dependencies if React Native version >=0.71.0.
  # See https://github.com/facebook/react-native/blob/febf6b7f33fdb4904669f99d795eba4c0f95d7bf/scripts/cocoapods/new_architecture.rb#L79.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"

    # Don't install the dependencies when we run `pod install` in the old architecture.
    if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
      s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
      s.pod_target_xcconfig    = {
          "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
          "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
          "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
      }
      s.dependency "React-Codegen"
      s.dependency "RCT-Folly"
      s.dependency "RCTRequired"
      s.dependency "RCTTypeSafety"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
